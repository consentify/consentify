import type { ConsentMode, ConsentState, UserCategory, VisitorIdSource } from './types';
import { canLocalStorage, isBrowser, logW } from './util';
import { dropStoredVisitorId, ephemeralVisitorId, readOrCreateStoredVisitorId, resolveVisitorId } from './visitor';

/**
 * Site configuration published to the CDN. Fields beyond these pass through
 * unchanged, so new optional fields can be added without breaking caches.
 */
export interface SiteConfig {
    categories: readonly string[];
    policyIdentifier: string;
    mode?: ConsentMode;
    consentMaxAgeDays?: number;
}

/** Where a cloud instance got its SiteConfig from. */
export type SiteConfigSource = 'network' | 'cache' | 'stale' | 'fallback';

export const DEFAULT_CONFIG_ENDPOINT = 'https://cdn.consentify.dev';
export const DEFAULT_INGEST_ENDPOINT = 'https://ingest.consentify.dev';
export const EVENT_BUFFER_KEY = 'consentify_event_buffer';
export const LAST_EVENT_KEY = 'consentify_last_event';

export type CloudAction = 'accept_all' | 'reject_all' | 'customize';

export function deriveCloudAction<T extends UserCategory>(
    state: ConsentState<T>,
    userCats: readonly string[],
): CloudAction {
    if (state.decision !== 'decided') return 'customize';
    const choices = state.snapshot.choices as Record<string, boolean>;
    if (userCats.every(c => choices[c] === true)) return 'accept_all';
    if (userCats.every(c => !choices[c])) return 'reject_all';
    return 'customize';
}

export interface BufferedEvent { url: string; body: string; apiKey?: string }

export function readPendingEvent(): BufferedEvent | null {
    if (!canLocalStorage()) return null;
    try {
        const raw = window.localStorage.getItem(EVENT_BUFFER_KEY);
        return raw ? JSON.parse(raw) as BufferedEvent : null;
    } catch { return null; }
}

export function savePendingEvent(evt: BufferedEvent): void {
    if (!canLocalStorage()) return;
    try {
        window.localStorage.setItem(EVENT_BUFFER_KEY, JSON.stringify(evt));
    } catch (err) {
        logW('persist cloud evt:', err);
    }
}

export const dropEvent = (): void => {
    if (!canLocalStorage()) return;
    try {
        window.localStorage.removeItem(EVENT_BUFFER_KEY);
    } catch (err) {
        logW('drop pending cloud evt:', err);
    }
};

// fetch with keepalive survives page unload on modern browsers, so a separate
// navigator.sendBeacon path is unnecessary here.
export function postCloudEvent(evt: BufferedEvent): Promise<boolean> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (evt.apiKey) headers['X-API-Key'] = evt.apiKey;
    return fetch(evt.url, { method: 'POST', headers, body: evt.body, keepalive: true })
        .then(res => res.ok)
        .catch(() => false);
}

export interface StartCloudReportingOptions {
    siteId: string;
    apiKey?: string;
    ingestEndpoint: string;
    /** Integrator-supplied id; when set it is sent with every event. */
    visitorId?: VisitorIdSource;
}

/**
 * Minimal instance shape needed for cloud reporting. Kept structural so we
 * avoid a circular type import from the main entry point.
 */
export interface CloudReportingInstance<T extends UserCategory = string> {
    policy: { readonly categories: readonly string[]; readonly identifier: string };
    get: () => ConsentState<T>;
    subscribe: (cb: () => void) => () => void;
}

export function startCloudReporting<T extends UserCategory>(
    instance: CloudReportingInstance<T>,
    opts: StartCloudReportingOptions,
): () => void {
    if (!isBrowser()) return () => {};
    const url = `${opts.ingestEndpoint.replace(/\/$/, '')}/v1/events`;
    const userCats = instance.policy.categories.filter(c => c !== 'necessary');
    // Dedup events by `siteId + policy + givenAt`; `givenAt` is a fresh ISO
    // timestamp on every real write, so identical snapshots (e.g. cross-tab
    // echoes) share a key and are suppressed. The key is mirrored to
    // localStorage so the init-time send of an already-decided state does not
    // re-report the same decision on every page load. On storage failure the
    // dedup silently degrades to in-memory only.
    const lastKeyStore = (key?: string): string => {
        try {
            if (!canLocalStorage()) return '';
            if (key) window.localStorage.setItem(LAST_EVENT_KEY, key);
            return window.localStorage.getItem(LAST_EVENT_KEY) ?? '';
        } catch { return ''; }
    };
    let lastKey = lastKeyStore();

    // Flush any pending event left over from a previous session. Whether the
    // retry succeeds or fails, drop it - no infinite re-queue.
    const pending = readPendingEvent();
    if (pending) void postCloudEvent(pending).finally(dropEvent);

    // The visitor id is resolved per event, at send time, so nothing touches
    // `consentify_visitor` before the first decision (the retry buffer above
    // replays a finished body). An explicit `visitorId` is the integrator's
    // own identifier and is always sent. Otherwise accept/customize mints or
    // reuses the stored id, and reject_all deletes it and sends a one-off
    // token, so a refusal is never linked to a persistent id.
    const resolveId = async (action: CloudAction): Promise<string> => {
        if (opts.visitorId) return resolveVisitorId(opts.visitorId);
        if (action !== 'reject_all') return readOrCreateStoredVisitorId();
        dropStoredVisitorId();
        return ephemeralVisitorId();
    };

    const send = (state: ConsentState<T>): void => {
        if (state.decision !== 'decided') return;
        const key = opts.siteId + '|' + state.snapshot.policy + '|' + state.snapshot.givenAt;
        // Check storage too: another tab may have reported this snapshot already.
        if (key === lastKey || key === lastKeyStore()) return;
        lastKey = key;
        lastKeyStore(key);
        const action = deriveCloudAction(state, userCats);
        void (async () => {
            // A failing `visitorId` factory falls back to a one-off token.
            const visitorHash = await resolveId(action).catch(err => {
                logW('visitorId failed:', err);
                return ephemeralVisitorId();
            });
            // Payload key is `visitorHash` to match the ingest-endpoint contract;
            // the SDK config calls it `visitorId` everywhere else.
            const body = JSON.stringify({
                siteId: opts.siteId,
                action,
                categories: state.snapshot.choices,
                visitorHash,
                policyVersion: state.snapshot.policy,
                ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
            });
            const evt: BufferedEvent = { url, body, apiKey: opts.apiKey };
            const ok = await postCloudEvent(evt);
            if (ok) dropEvent(); else savePendingEvent(evt);
        })();
    };

    const current = instance.get();
    if (current.decision === 'decided') send(current);
    return instance.subscribe(() => { send(instance.get()); });
}

// --- SiteConfig loading -----------------------------------------------------
// Two-hop CDN protocol: `/config/<siteId>/latest.json` (short CDN TTL) names
// the current hash; `/config/<siteId>/<hash>.json` is immutable.

/** Cache record: fetched-at (epoch ms), `latest.json` hash, SiteConfig. */
export interface CachedSiteConfig { t: number; h: string; c: SiteConfig }

export const CONFIG_CACHE_PREFIX = 'consentify_cfg_';

const isSiteConfig = (c?: Partial<SiteConfig> | null): c is SiteConfig =>
    !!c && Array.isArray(c.categories) && typeof c.policyIdentifier === 'string';

/**
 * Fetch the current SiteConfig within one `timeoutMs` deadline for both hops.
 * When `latest.json` still names `prev.h`, the second hop is skipped. Never
 * rejects: resolves `null` on network error, timeout, non-OK status or a
 * malformed body.
 */
export function fetchSiteConfig(
    base: string,
    timeoutMs: number,
    prev?: CachedSiteConfig,
): Promise<CachedSiteConfig | null> {
    const ctl = new AbortController();
    const get = (file: string): Promise<unknown> =>
        fetch(base + file, { signal: ctl.signal }).then(r => (r.ok ? r.json() : null));
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
        (async () => {
            const h = ((await get('latest.json')) as { current?: unknown } | null)?.current;
            if (typeof h !== 'string' || !h) return null;
            const c = (prev?.h === h ? prev.c : await get(h + '.json')) as Partial<SiteConfig> | null;
            return isSiteConfig(c) ? { t: Date.now(), h, c } : null;
        })().catch(() => null),
        // Aborting also cancels a request or body read still in flight.
        new Promise<null>(r => { timer = setTimeout(() => { ctl.abort(); r(null); }, timeoutMs); }),
    ]).finally(() => clearTimeout(timer));
}

interface ConfigSlot { e?: CachedSiteConfig; p?: Promise<CachedSiteConfig | null> }
// Server-side memo keyed by `endpoint|siteId`, so SSR does not fetch per request.
const serverMemo = new Map<string, ConfigSlot>();

/**
 * Resolve a SiteConfig with stale-while-revalidate caching: localStorage
 * (`consentify_cfg_<siteId>`) in the browser, an in-module Map elsewhere
 * (concurrent calls share one in-flight request). Fresh cache: no network.
 * Stale cache: returned at once and refreshed in the background (the cache
 * only; a running instance keeps its policy). No cache: wait for the network.
 * Resolves `['fallback']` when nothing usable is available.
 */
export async function loadSiteConfig(
    siteId: string,
    endpoint: string,
    timeoutMs: number,
    ttlMs: number,
): Promise<[SiteConfigSource, SiteConfig?]> {
    const lsKey = CONFIG_CACHE_PREFIX + siteId;
    const browser = isBrowser();
    const ls = browser && canLocalStorage();
    let slot: ConfigSlot = {};
    if (!browser) {
        const k = endpoint + '|' + siteId;
        slot = serverMemo.get(k) ?? slot;
        serverMemo.set(k, slot);
    } else if (ls) {
        try {
            const e = JSON.parse(window.localStorage.getItem(lsKey) as string);
            if (isSiteConfig(e?.c)) slot.e = e;
        } catch { /* blocked or corrupt: no cache */ }
    }
    const cached = slot.e;
    // A non-numeric or future `t` (clock moved back) yields NaN/negative: stale.
    const age = cached ? Date.now() - cached.t : -1;
    if (cached && age >= 0 && age < ttlMs) return ['cache', cached.c];
    if (!slot.p) {
        slot.p = fetchSiteConfig(`${endpoint.replace(/\/$/, '')}/config/${siteId}/`, timeoutMs, cached)
            .then(e => {
                slot.p = undefined;
                if (e) {
                    slot.e = e;
                    try {
                        if (ls) window.localStorage.setItem(lsKey, JSON.stringify(e));
                    } catch { /* quota or blocked: the cache is best effort */ }
                }
                return e;
            });
    }
    if (cached) return ['stale', cached.c];
    const fresh = await slot.p;
    return fresh ? ['network', fresh.c] : ['fallback'];
}

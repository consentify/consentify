// Named JSON import: esbuild inlines only `version`, so bundles carry the
// version of the package they were built from.
import { version } from '../../package.json';
import type { ConsentMode, ConsentProof, ConsentState, Snapshot, UserCategory, VisitorIdSource } from './types';
import { canLocalStorage, isBrowser, logW } from './util';
import {
    dropStoredVisitorId,
    ephemeralVisitorId,
    generateVisitorId,
    readOrCreateStoredVisitorId,
    resolveVisitorId,
} from './visitor';

/**
 * Third-party vendor listed in a SiteConfig. Data for the consent UI only:
 * the SDK attaches no consent logic to vendors.
 */
export interface Vendor {
    id: string;
    /** Consent category the vendor belongs to. */
    category: string;
    name: string;
    privacyPolicyUrl?: string;
}

/**
 * Site configuration published to the CDN. Fields beyond these pass through
 * unchanged, so new optional fields can be added without breaking caches.
 */
export interface SiteConfig {
    /** SiteConfig format: `2`, or absent on v1 configs. */
    v?: 2;
    categories: readonly string[];
    policyIdentifier: string;
    /** Policy text version, recorded as `pv` on every new consent record. */
    policyTextVersion?: string;
    mode?: ConsentMode;
    consentMaxAgeDays?: number;
    /** Locales the consent UI is published in (BCP 47 tags). */
    locales?: string[];
    defaultLocale?: string;
    vendors?: Vendor[];
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

/**
 * Ingest event v2, POSTed as JSON to `<ingest>/v2/events`. Contract:
 * `docs/plans/2026-10-07-saas-contract-v2.md`.
 */
export interface IngestEvent<T extends UserCategory = string> {
    v: 2;
    /** Random UUID per event; the idempotency key (a buffered retry resends it unchanged). */
    eventId: string;
    siteId: string;
    action: CloudAction;
    /** The consent record as stored (v2, or v1 for records written by SDK 2.x). */
    record: Snapshot<T>;
    /** Absent on server events without an explicit `visitorId`. */
    visitorHash?: string;
    /** Version of `@consentify/core` that built the event. */
    sdkVersion: string;
    /** HMAC proof of `record`. Server events only, when the instance has a `secret`. */
    proof?: ConsentProof<T>;
}

/** Header carrying `CloudInit.publicKey` (browser events). */
export const PUBLIC_KEY_HEADER = 'X-Consentify-Key';
/** Header carrying the server key (`reportConsent`). */
export const SERVER_KEY_HEADER = 'X-Consentify-Server-Key';

export const eventsUrl = (ingest: string): string => ingest.replace(/\/$/, '') + '/v2/events';

// `undefined` fields (`visitorHash`, `proof`) are dropped by JSON.stringify.
export const eventBody = <T extends UserCategory>(
    siteId: string,
    action: CloudAction,
    record: Snapshot<T>,
    visitorHash?: string,
    proof?: ConsentProof<T>,
): string => JSON.stringify({
    v: 2, eventId: generateVisitorId(), siteId, action, record, visitorHash, sdkVersion: version, proof,
} satisfies IngestEvent<T>);

export interface BufferedEvent { url: string; body: string; publicKey?: string }

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
// navigator.sendBeacon path is unnecessary here. Resolves `false` on network
// errors, aborts and non-2xx answers; never rejects.
export function postEvent(url: string, body: string, headers: Record<string, string>, signal?: AbortSignal): Promise<boolean> {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body, keepalive: true, signal })
        .then(res => res.ok)
        .catch(() => false);
}

// The public key goes in a header only, never in the body.
export const postCloudEvent = (evt: BufferedEvent): Promise<boolean> =>
    postEvent(evt.url, evt.body, evt.publicKey ? { [PUBLIC_KEY_HEADER]: evt.publicKey } : {});

export interface StartCloudReportingOptions {
    siteId: string;
    publicKey?: string;
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
    const url = eventsUrl(opts.ingestEndpoint);
    const userCats = instance.policy.categories.filter(c => c !== 'necessary');
    // Dedup events by `siteId + policy + id` (`givenAt` for v1 records, which
    // have no `id`); every real write gets a fresh random `id`, so identical
    // snapshots (e.g. cross-tab echoes) share a key and are suppressed, while
    // two decisions in the same millisecond do not. The key is mirrored to
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
        const key = opts.siteId + '|' + state.snapshot.policy + '|' + (state.snapshot.id ?? state.snapshot.givenAt);
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
            // the SDK config calls it `visitorId` everywhere else. Browser
            // events never carry a proof (the secret is server-only).
            const body = eventBody(opts.siteId, action, state.snapshot, visitorHash);
            const evt: BufferedEvent = { url, body, publicKey: opts.publicKey };
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

const isStr = (x: unknown): x is string => typeof x === 'string';
const isNonEmptyStr = (x: unknown): boolean => isStr(x) && x !== '';
const optStr = (x: unknown): boolean => x === undefined || isStr(x);
const optArr = <T>(x: T[] | undefined, ok: (i: T) => boolean): boolean =>
    x === undefined || (Array.isArray(x) && x.every(ok));

// Light shape check; a wrong type anywhere makes the whole config malformed.
const isSiteConfig = (c?: Partial<SiteConfig> | null): c is SiteConfig =>
    !!c && Array.isArray(c.categories) && c.categories.every(isNonEmptyStr) && isNonEmptyStr(c.policyIdentifier) &&
    (c.v === undefined || c.v === 2) && optStr(c.policyTextVersion) && optStr(c.defaultLocale) &&
    (c.mode === undefined || c.mode === 'opt-in' || c.mode === 'opt-out') &&
    (c.consentMaxAgeDays === undefined || (Number.isFinite(c.consentMaxAgeDays) && c.consentMaxAgeDays > 0)) &&
    optArr(c.locales, isStr) &&
    optArr(c.vendors, x => !!x && isStr(x.id) && isStr(x.category) && isStr(x.name) && optStr(x.privacyPolicyUrl));

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

// `f`: when the last fetch for a slot without a usable entry failed (epoch ms).
interface ConfigSlot { e?: CachedSiteConfig; p?: Promise<CachedSiteConfig | null>; f?: number }
// Server-side memo keyed by `endpoint|siteId`, so SSR does not fetch per request.
const serverMemo = new Map<string, ConfigSlot>();
/** After a failed fetch with nothing to serve, the server uses the fallback at once for this long. */
export const CONFIG_FAIL_TTL_MS = 30_000;

/**
 * Resolve a SiteConfig with stale-while-revalidate caching: localStorage
 * (`consentify_cfg_<siteId>`) in the browser, an in-module Map elsewhere
 * (concurrent calls share one in-flight request). Fresh cache (younger than
 * `ttlMs`): no network. Stale cache (younger than `maxStaleMs`): returned at
 * once and refreshed in the background (the cache only; a running instance
 * keeps its policy). No cache, or older than `maxStaleMs`: wait for the
 * network. Resolves `['fallback']` when nothing usable is available. On the
 * server a failed fetch is remembered for `CONFIG_FAIL_TTL_MS`, so an outage
 * costs one `timeoutMs` wait per window instead of one per request.
 */
export async function loadSiteConfig(
    siteId: string,
    endpoint: string,
    timeoutMs: number,
    ttlMs: number,
    maxStaleMs: number,
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
    // A non-numeric or future `t` (clock moved back) yields NaN/negative: too old.
    const age = slot.e ? Date.now() - slot.e.t : -1;
    if (slot.e && age >= 0 && age < ttlMs) return ['cache', slot.e.c];
    // Past `maxStaleMs` the entry is not served (the policy may have changed
    // long ago), but its hash still lets the fetch skip the second hop.
    const cached = age >= 0 && age < maxStaleMs ? slot.e : undefined;
    if (!cached && slot.f && Date.now() - slot.f < CONFIG_FAIL_TTL_MS) return ['fallback'];
    if (!slot.p) {
        slot.p = fetchSiteConfig(`${endpoint.replace(/\/$/, '')}/config/${siteId}/`, timeoutMs, slot.e)
            .then(e => {
                slot.p = undefined;
                slot.f = e ? undefined : Date.now();
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

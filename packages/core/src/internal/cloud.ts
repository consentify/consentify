import type { ConsentMode, ConsentState, ConsentifyConfigError, UserCategory } from './types';
import { ConsentifyConfigError as ConfigError } from './types';
import { TAG, canLocalStorage, isBrowser, logW } from './util';
import { generateVisitorId, readOrCreateStoredVisitorId } from './visitor';

export interface SiteConfig {
    categories: readonly string[];
    policyIdentifier: string;
    mode?: ConsentMode;
    consentMaxAgeDays?: number;
}

export const DEFAULT_CONFIG_ENDPOINT = 'https://cdn.consentify.dev';
export const DEFAULT_INGEST_ENDPOINT = 'https://ingest.consentify.dev';
export const EVENT_BUFFER_KEY = 'consentify_event_buffer';

export type CloudAction = 'accept_all' | 'reject_all' | 'customize';

export function deriveCloudAction<T extends UserCategory>(
    state: ConsentState<T>,
    categories: readonly string[],
): CloudAction {
    if (state.decision !== 'decided') return 'customize';
    const choices = state.snapshot.choices as Record<string, boolean>;
    const userCats = categories.filter(c => c !== 'necessary');
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
        logW('Could not persist pending cloud event:', err);
    }
}

export const dropEvent = (): void => {
    if (canLocalStorage()) try { window.localStorage.removeItem(EVENT_BUFFER_KEY); } catch {}
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
    const categories = instance.policy.categories;
    // `lastKey` dedups consecutive events with identical snapshots. Choices are
    // serialized after going through `normalize()`, which iterates
    // `policy.categories` in declaration order, so key order is deterministic.
    let lastKey = '';

    // Flush any pending event left over from a previous session. Whether the
    // retry succeeds or fails, drop it - no infinite re-queue.
    const pending = readPendingEvent();
    if (pending) void postCloudEvent(pending).finally(dropEvent);

    const visitorHash = canLocalStorage() ? readOrCreateStoredVisitorId() : generateVisitorId();

    const send = (state: ConsentState<T>): void => {
        if (state.decision !== 'decided') return;
        const choices = state.snapshot.choices as Record<string, boolean>;
        const key = state.snapshot.policy + ':' + JSON.stringify(choices);
        if (key === lastKey) return;
        lastKey = key;
        // Payload key is `visitorHash` to match the ingest-endpoint contract;
        // the SDK config calls it `visitorId` everywhere else.
        const body = JSON.stringify({
            siteId: opts.siteId,
            action: deriveCloudAction(state, categories),
            categories: choices,
            visitorHash,
            policyVersion: state.snapshot.policy,
            ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
        });
        const evt: BufferedEvent = { url, body, apiKey: opts.apiKey };
        void (async () => {
            const ok = await postCloudEvent(evt);
            if (ok) dropEvent(); else savePendingEvent(evt);
        })();
    };

    const current = instance.get();
    if (current.decision === 'decided') send(current);
    return instance.subscribe(() => { send(instance.get()); });
}

// Local re-use of the type name so consumers can still catch `ConsentifyConfigError`.
export type { ConsentifyConfigError };

export async function fetchSiteConfig(
    siteId: string,
    configEndpoint: string,
): Promise<SiteConfig> {
    const base = configEndpoint.replace(/\/$/, '');
    try {
        const latestRes = await fetch(`${base}/config/${siteId}/latest.json`);
        if (!latestRes.ok) {
            throw new Error(`latest.json responded with ${latestRes.status}`);
        }
        const latest = await latestRes.json() as { current?: string };
        if (!latest || typeof latest.current !== 'string' || !latest.current) {
            throw new Error('latest.json is missing `current` hash');
        }
        const cfgRes = await fetch(`${base}/config/${siteId}/${latest.current}.json`);
        if (!cfgRes.ok) {
            throw new Error(`${latest.current}.json responded with ${cfgRes.status}`);
        }
        const cfg = await cfgRes.json() as Partial<SiteConfig>;
        if (!cfg || !Array.isArray(cfg.categories) || typeof cfg.policyIdentifier !== 'string') {
            throw new Error('SiteConfig is malformed');
        }
        return {
            categories: cfg.categories,
            policyIdentifier: cfg.policyIdentifier,
            mode: cfg.mode,
            consentMaxAgeDays: cfg.consentMaxAgeDays,
        };
    } catch (cause) {
        throw new ConfigError(
            TAG + `Failed to fetch SiteConfig for "${siteId}"`,
            { cause },
        );
    }
}

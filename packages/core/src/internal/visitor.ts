import type { VisitorIdSource } from './types';
import { canLocalStorage, toHex } from './util';

export const VISITOR_KEY = 'consentify_visitor';

/**
 * Returns a stable-ish identifier per visitor. Prefers `crypto.randomUUID()`
 * for UUIDv4 quality when available; falls back to `Math.random()` only on
 * very old browsers that lack Web Crypto. The `Math.random` fallback is not
 * cryptographic and must not be relied on for anything security-sensitive.
 */
export function generateVisitorId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    // Non-cryptographic fallback: low collision risk is acceptable for an
    // opaque visitor key, but do not use this branch for secrets.
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

/**
 * Reads the id stored under `consentify_visitor`. With `create` (default) it
 * mints and stores one when none exists: call that only after a consent
 * decision. With `create === false` it returns `''` when nothing is stored.
 */
export function readOrCreateStoredVisitorId(create = true): string {
    try {
        const stored = window.localStorage.getItem(VISITOR_KEY);
        if (stored || !create) return stored || '';
        const fresh = generateVisitorId();
        window.localStorage.setItem(VISITOR_KEY, fresh);
        return fresh;
    } catch {
        return create ? generateVisitorId() : '';
    }
}

/** Deletes the stored visitor id (on `reject_all`: the user withdrew). */
export function dropStoredVisitorId(): void {
    try { window.localStorage.removeItem(VISITOR_KEY); } catch { /* blocked: nothing stored */ }
}

/** One-off token for a `reject_all` event: 8 random hex chars, never stored. */
export const ephemeralVisitorId = (): string => toHex(crypto.getRandomValues(new Uint8Array(4)).buffer);

/** `create` as in `readOrCreateStoredVisitorId`; an explicit `source` always wins. */
export async function resolveVisitorId(source?: VisitorIdSource, create?: boolean): Promise<string> {
    if (typeof source === 'string') return source;
    if (typeof source === 'function') {
        const result = source();
        return typeof result === 'string' ? result : await result;
    }
    if (canLocalStorage()) return readOrCreateStoredVisitorId(create);
    return '';
}

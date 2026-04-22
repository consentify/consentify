import type { VisitorIdSource } from './types';
import { canLocalStorage } from './util';

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

export function readOrCreateStoredVisitorId(): string {
    try {
        const stored = window.localStorage.getItem(VISITOR_KEY);
        if (stored) return stored;
        const fresh = generateVisitorId();
        window.localStorage.setItem(VISITOR_KEY, fresh);
        return fresh;
    } catch {
        return generateVisitorId();
    }
}

export async function resolveVisitorId(source?: VisitorIdSource): Promise<string> {
    if (typeof source === 'string') return source;
    if (typeof source === 'function') {
        const result = source();
        return typeof result === 'string' ? result : await result;
    }
    if (canLocalStorage()) return readOrCreateStoredVisitorId();
    return '';
}

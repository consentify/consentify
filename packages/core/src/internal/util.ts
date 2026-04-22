import type { Snapshot, UserCategory } from './types';

export const MS_PER_DAY = 86_400_000; // 24 * 60 * 60 * 1000
export const TAG = '[consentify] ';

// Diagnostics helpers keep the '[consentify] ' prefix single-sourced so the
// minified bundle stays inside its size budget.
export const logW = (msg: string, ...args: unknown[]): void => console.warn(TAG + msg, ...args);
export const logE = (msg: string, ...args: unknown[]): void => console.error(TAG + msg, ...args);

export const enc = (o: unknown): string => encodeURIComponent(JSON.stringify(o));
export const dec = <T>(s: string): T | null => {
    try { return JSON.parse(decodeURIComponent(s)) as T; } catch { return null; }
};
export const toISO = (): string => new Date().toISOString();

export const isBrowser = (): boolean =>
    typeof window !== 'undefined' && typeof document !== 'undefined';

export const canLocalStorage = (): boolean => {
    try { return isBrowser() && !!window.localStorage; } catch { return false; }
};

export const toHex = (buf: ArrayBuffer): string =>
    Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');

/** @internal */
export function stableStringify(o: unknown): string {
    if (o === null || typeof o !== 'object') return JSON.stringify(o);
    if (Array.isArray(o)) return `[${o.map(stableStringify).join(',')}]`;
    const e = Object.entries(o as Record<string, unknown>).sort((a, b) => a[0].localeCompare(b[0]));
    return `{${e.map(([k, v]) => JSON.stringify(k) + ':' + stableStringify(v)).join(',')}}`;
}

/** @internal */
export function fnv1a(str: string): string {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
}

/** @internal */
export function hashPolicy(categories: readonly string[], identifier?: string): string {
    // Deterministic identity for the policy. If you provide `identifier`, it is folded into the hash,
    // but consider using `identifier` itself as the canonical version key for clarity.
    return fnv1a(stableStringify({ categories: [...categories].sort(), identifier: identifier ?? null}));
}

export function isValidSnapshot<T extends UserCategory>(s: unknown): s is Snapshot<T> {
    if (
        typeof s !== 'object' || s === null ||
        typeof (s as any).policy !== 'string' || (s as any).policy === '' ||
        typeof (s as any).givenAt !== 'string' ||
        typeof (s as any).choices !== 'object' || (s as any).choices === null
    ) return false;
    if (isNaN(new Date((s as any).givenAt).getTime())) return false;
    for (const v of Object.values((s as any).choices)) {
        if (typeof v !== 'boolean') return false;
    }
    return true;
}

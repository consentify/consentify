import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createConsentify, defaultCategories, enableConsentMode, enableDebug, type ConsentifySubscribable, type ConsentState } from './index';

// --- Exported helper access (re-implement for testing since they're not exported) ---

function stableStringify(o: unknown): string {
    if (o === null || typeof o !== 'object') return JSON.stringify(o);
    if (Array.isArray(o)) return `[${o.map(stableStringify).join(',')}]`;
    const e = Object.entries(o as Record<string, unknown>).sort((a, b) => a[0].localeCompare(b[0]));
    return `{${e.map(([k, v]) => JSON.stringify(k) + ':' + stableStringify(v)).join(',')}}`;
}

function fnv1a(str: string): string {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
}

function hashPolicy(categories: readonly string[], identifier?: string): string {
    return fnv1a(stableStringify({ categories: [...categories].sort(), identifier: identifier ?? null }));
}

// Helper to encode a snapshot as document.cookie value
const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o));

function setCookie(name: string, value: string) {
    document.cookie = `${name}=${value}; Path=/`;
}
function clearAllCookies() {
    document.cookie.split(';').forEach(c => {
        const name = c.split('=')[0].trim();
        if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
    });
}

// --- MockBroadcastChannel for multi-tab sync tests ---
class MockBroadcastChannel {
    static channels = new Map<string, Set<MockBroadcastChannel>>();
    onmessage: ((event: MessageEvent) => void) | null = null;

    constructor(public name: string) {
        if (!MockBroadcastChannel.channels.has(name)) {
            MockBroadcastChannel.channels.set(name, new Set());
        }
        MockBroadcastChannel.channels.get(name)!.add(this);
    }

    postMessage(data: unknown) {
        for (const ch of MockBroadcastChannel.channels.get(this.name) ?? []) {
            if (ch !== this) ch.onmessage?.(new MessageEvent('message', { data }));
        }
    }

    close() {
        MockBroadcastChannel.channels.get(this.name)?.delete(this);
    }
}

// ============================================================
// 1. Utility functions
// ============================================================
describe('stableStringify', () => {
    it('produces deterministic output regardless of key order', () => {
        expect(stableStringify({ b: 2, a: 1 })).toBe(stableStringify({ a: 1, b: 2 }));
    });
    it('handles nested objects', () => {
        expect(stableStringify({ z: { b: 1, a: 2 } })).toBe('{"z":{"a":2,"b":1}}');
    });
    it('handles arrays', () => {
        expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
    });
    it('handles null and primitives', () => {
        expect(stableStringify(null)).toBe('null');
        expect(stableStringify('hello')).toBe('"hello"');
        expect(stableStringify(42)).toBe('42');
    });
});

describe('fnv1a', () => {
    it('returns consistent 8-char hex string', () => {
        const h = fnv1a('test');
        expect(h).toMatch(/^[0-9a-f]{8}$/);
        expect(fnv1a('test')).toBe(h);
    });
    it('produces different hashes for different inputs', () => {
        expect(fnv1a('abc')).not.toBe(fnv1a('def'));
    });
});

describe('hashPolicy', () => {
    it('is stable across category order', () => {
        expect(hashPolicy(['a', 'b'])).toBe(hashPolicy(['b', 'a']));
    });
    it('changes when categories change', () => {
        expect(hashPolicy(['a'])).not.toBe(hashPolicy(['a', 'b']));
    });
    it('folds identifier into hash', () => {
        expect(hashPolicy(['a'], 'v1')).not.toBe(hashPolicy(['a']));
    });
});

// ============================================================
// 2. Cookie parsing
// ============================================================
describe('readCookie (via server.get)', () => {
    it('returns unset when no cookie', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] } });
        expect(c.server.get('')).toEqual({ decision: 'unset' });
    });
    it('returns unset for null/undefined', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] } });
        expect(c.server.get(null)).toEqual({ decision: 'unset' });
        expect(c.server.get(undefined)).toEqual({ decision: 'unset' });
    });
    it('parses cookie among multiple cookies', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] } });
        const snapshot = {
            policy: c.policy.identifier,
            givenAt: new Date().toISOString(),
            choices: { necessary: true, analytics: true },
        };
        const header = `other=foo; consentify=${enc(snapshot)}; another=bar`;
        const state = c.server.get(header);
        expect(state.decision).toBe('decided');
    });
});

describe('writeCookie (via client)', () => {
    beforeEach(clearAllCookies);
    it('writes to document.cookie via client.set()', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] } });
        c.client.set({ analytics: true });
        expect(document.cookie).toContain('consentify=');
    });
});

// ============================================================
// 3. Snapshot validation
// ============================================================
describe('isValidSnapshot (via server.get)', () => {
    const makeInstance = () => createConsentify({ policy: { categories: ['analytics'] } });

    it('accepts a valid snapshot', () => {
        const c = makeInstance();
        const snapshot = {
            policy: c.policy.identifier,
            givenAt: new Date().toISOString(),
            choices: { necessary: true, analytics: false },
        };
        const header = `consentify=${enc(snapshot)}`;
        expect(c.server.get(header).decision).toBe('decided');
    });

    it('rejects missing fields', () => {
        const c = makeInstance();
        const bad = { policy: c.policy.identifier, choices: { necessary: true, analytics: false } };
        expect(c.server.get(`consentify=${enc(bad)}`).decision).toBe('unset');
    });

    it('rejects non-boolean choices', () => {
        const c = makeInstance();
        const bad = {
            policy: c.policy.identifier,
            givenAt: new Date().toISOString(),
            choices: { necessary: true, analytics: 'yes' },
        };
        expect(c.server.get(`consentify=${enc(bad)}`).decision).toBe('unset');
    });

    it('rejects invalid dates', () => {
        const c = makeInstance();
        const bad = {
            policy: c.policy.identifier,
            givenAt: 'not-a-date',
            choices: { necessary: true, analytics: false },
        };
        expect(c.server.get(`consentify=${enc(bad)}`).decision).toBe('unset');
    });

    it('rejects empty policy string', () => {
        const c = makeInstance();
        const bad = {
            policy: '',
            givenAt: new Date().toISOString(),
            choices: { necessary: true, analytics: false },
        };
        expect(c.server.get(`consentify=${enc(bad)}`).decision).toBe('unset');
    });
});

// ============================================================
// 4. createConsentify — server API
// ============================================================
describe('server API', () => {
    it('get() returns unset when no cookie', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] } });
        expect(c.server.get('')).toEqual({ decision: 'unset' });
    });

    it('get() returns decided with valid cookie', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] } });
        const snapshot = {
            policy: c.policy.identifier,
            givenAt: new Date().toISOString(),
            choices: { necessary: true, analytics: true },
        };
        const state = c.server.get(`consentify=${enc(snapshot)}`);
        expect(state.decision).toBe('decided');
        if (state.decision === 'decided') {
            expect(state.snapshot.choices.analytics).toBe(true);
        }
    });

    it('get() returns unset on policy mismatch', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] } });
        const snapshot = {
            policy: 'wrong-hash',
            givenAt: new Date().toISOString(),
            choices: { necessary: true, analytics: true },
        };
        expect(c.server.get(`consentify=${enc(snapshot)}`).decision).toBe('unset');
    });

    it('get() returns unset on expired consent', () => {
        const c = createConsentify({
            policy: { categories: ['analytics'] },
            consentMaxAgeDays: 1,
        });
        const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
        const snapshot = {
            policy: c.policy.identifier,
            givenAt: oldDate,
            choices: { necessary: true, analytics: true },
        };
        expect(c.server.get(`consentify=${enc(snapshot)}`).decision).toBe('unset');
    });

    it('set() returns a Set-Cookie header string', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] } });
        const header = c.server.set({ analytics: true });
        expect(header).toContain('consentify=');
        expect(header).toContain('Path=/');
        expect(header).toContain('SameSite=Lax');
    });

    it('clear() returns a clearing header with Max-Age=0', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] } });
        const header = c.server.clear();
        expect(header).toContain('Max-Age=0');
        expect(header).toContain('consentify=;');
    });

    it('necessary is always true in server.set()', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] } });
        const header = c.server.set({ necessary: false } as any);
        // Parse out the cookie value from the header
        const val = header.split(';')[0].split('=').slice(1).join('=');
        const snapshot = JSON.parse(decodeURIComponent(val));
        expect(snapshot.choices.necessary).toBe(true);
    });
});

// ============================================================
// 5. createConsentify — client API
// ============================================================
describe('client API', () => {
    beforeEach(clearAllCookies);

    it('get() returns unset initially', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] } });
        expect(c.client.get()).toEqual({ decision: 'unset' });
    });

    it('get(category) returns boolean', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        expect(c.client.get('necessary')).toBe(true);
        expect(c.client.get('analytics')).toBe(false);
    });

    it('set() stores and reads back', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        c.client.set({ analytics: true });
        const state = c.client.get();
        expect(state.decision).toBe('decided');
        if (state.decision === 'decided') {
            expect(state.snapshot.choices.analytics).toBe(true);
            expect(state.snapshot.choices.necessary).toBe(true);
        }
    });

    it('set() race condition: sequential sets preserve both', () => {
        const c = createConsentify({ policy: { categories: ['analytics', 'marketing'] as const } });
        c.client.set({ analytics: true });
        c.client.set({ marketing: true });
        const state = c.client.get();
        expect(state.decision).toBe('decided');
        if (state.decision === 'decided') {
            expect(state.snapshot.choices.analytics).toBe(true);
            expect(state.snapshot.choices.marketing).toBe(true);
        }
    });

    it('clear() resets to unset', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        c.client.set({ analytics: true });
        expect(c.client.get().decision).toBe('decided');
        c.client.clear();
        expect(c.client.get()).toEqual({ decision: 'unset' });
    });

    it('subscribe() callback fired on set and clear', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const cb = vi.fn();
        const unsub = c.client.subscribe(cb);
        c.client.set({ analytics: true });
        expect(cb).toHaveBeenCalledTimes(1);
        c.client.clear();
        expect(cb).toHaveBeenCalledTimes(2);
        unsub();
        c.client.set({ analytics: false });
        expect(cb).toHaveBeenCalledTimes(2); // no more calls after unsub
    });

    it('subscribe() one error does not break other listeners', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const bad = vi.fn(() => { throw new Error('boom'); });
        const good = vi.fn();
        c.client.subscribe(bad);
        c.client.subscribe(good);
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        c.client.set({ analytics: true });
        expect(bad).toHaveBeenCalled();
        expect(good).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('subscribe() error is logged via console.error', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const err = new Error('boom');
        c.client.subscribe(() => { throw err; });
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        c.client.set({ analytics: true });
        expect(spy).toHaveBeenCalledWith('[consentify] Listener callback threw:', err);
        spy.mockRestore();
    });

    it('getServerSnapshot() always returns unset', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        c.client.set({ analytics: true });
        expect(c.client.getServerSnapshot()).toEqual({ decision: 'unset' });
    });
});

// ============================================================
// 6. Storage fallback
// ============================================================
describe('storage fallback', () => {
    beforeEach(clearAllCookies);

    it('localStorage primary with cookie mirror', () => {
        const c = createConsentify({
            policy: { categories: ['analytics'] as const },
            storage: ['localStorage', 'cookie'],
        });
        c.client.set({ analytics: true });
        // Should be in both localStorage and cookie
        expect(window.localStorage.getItem('consentify')).toBeTruthy();
        expect(document.cookie).toContain('consentify=');
    });

    it('localStorage failure falls back gracefully', () => {
        const orig = window.localStorage.setItem;
        // Simulate quota exceeded
        window.localStorage.setItem = () => { throw new DOMException('QuotaExceeded'); };
        const c = createConsentify({
            policy: { categories: ['analytics'] as const },
            storage: ['localStorage', 'cookie'],
        });
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // Should not throw
        expect(() => c.client.set({ analytics: true })).not.toThrow();
        // Consent should be readable via the client API (cookie mirror worked)
        expect(c.client.get('analytics')).toBe(true);
        spy.mockRestore();
        window.localStorage.setItem = orig;
    });
});

// ============================================================
// 7. Policy versioning
// ============================================================
describe('policy versioning', () => {
    beforeEach(clearAllCookies);

    it('changed categories invalidate consent', () => {
        const c1 = createConsentify({ policy: { categories: ['analytics'] as const } });
        c1.client.set({ analytics: true });
        // New instance with different categories
        const c2 = createConsentify({ policy: { categories: ['analytics', 'marketing'] as const } });
        expect(c2.client.get()).toEqual({ decision: 'unset' });
    });

    it('custom identifier works', () => {
        const c = createConsentify({
            policy: { categories: ['analytics'] as const, identifier: 'v2' },
        });
        expect(c.policy.identifier).toBe('v2');
    });
});

// ============================================================
// 8. Consent expiration
// ============================================================
describe('consent expiration', () => {
    beforeEach(clearAllCookies);

    it('fresh consent is valid', () => {
        const c = createConsentify({
            policy: { categories: ['analytics'] },
            consentMaxAgeDays: 365,
        });
        const snapshot = {
            policy: c.policy.identifier,
            givenAt: new Date().toISOString(),
            choices: { necessary: true, analytics: true },
        };
        expect(c.server.get(`consentify=${enc(snapshot)}`).decision).toBe('decided');
    });

    it('old consent is expired', () => {
        const c = createConsentify({
            policy: { categories: ['analytics'] },
            consentMaxAgeDays: 30,
        });
        const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
        const snapshot = {
            policy: c.policy.identifier,
            givenAt: oldDate,
            choices: { necessary: true, analytics: true },
        };
        expect(c.server.get(`consentify=${enc(snapshot)}`).decision).toBe('unset');
    });

    it('invalid date treated as expired', () => {
        const c = createConsentify({
            policy: { categories: ['analytics'] },
            consentMaxAgeDays: 365,
        });
        const snapshot = {
            policy: c.policy.identifier,
            givenAt: 'invalid-date',
            choices: { necessary: true, analytics: true },
        };
        // With hardened validation, invalid date is rejected by isValidSnapshot
        expect(c.server.get(`consentify=${enc(snapshot)}`).decision).toBe('unset');
    });
});

// ============================================================
// 9. client.guard()
// ============================================================
describe('client.guard()', () => {
    beforeEach(clearAllCookies);

    it('fires immediately when already consented', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        c.client.set({ analytics: true });
        const onGrant = vi.fn();
        c.client.guard('analytics', onGrant);
        expect(onGrant).toHaveBeenCalledTimes(1);
    });

    it('defers until consent is granted', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const onGrant = vi.fn();
        c.client.guard('analytics', onGrant);
        expect(onGrant).not.toHaveBeenCalled();
        c.client.set({ analytics: true });
        expect(onGrant).toHaveBeenCalledTimes(1);
    });

    it('onRevoke fires when consent is withdrawn', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const onGrant = vi.fn();
        const onRevoke = vi.fn();
        c.client.guard('analytics', onGrant, onRevoke);
        c.client.set({ analytics: true });
        expect(onGrant).toHaveBeenCalledTimes(1);
        c.client.set({ analytics: false });
        expect(onRevoke).toHaveBeenCalledTimes(1);
    });

    it('does not fire onGrant again after revoke', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const onGrant = vi.fn();
        const onRevoke = vi.fn();
        c.client.guard('analytics', onGrant, onRevoke);
        c.client.set({ analytics: true });
        c.client.set({ analytics: false });
        c.client.set({ analytics: true });
        expect(onGrant).toHaveBeenCalledTimes(1);
        expect(onRevoke).toHaveBeenCalledTimes(1);
    });

    it('dispose cancels before grant', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const onGrant = vi.fn();
        const dispose = c.client.guard('analytics', onGrant);
        dispose();
        c.client.set({ analytics: true });
        expect(onGrant).not.toHaveBeenCalled();
    });

    it('dispose cancels before revoke', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const onGrant = vi.fn();
        const onRevoke = vi.fn();
        c.client.guard('analytics', onGrant, onRevoke);
        c.client.set({ analytics: true });
        const dispose = c.client.guard('analytics', vi.fn(), onRevoke);
        dispose();
        c.client.set({ analytics: false });
        // onRevoke from the first guard fires, but not the disposed one
        expect(onRevoke).toHaveBeenCalledTimes(1);
    });

    it('guard("necessary") fires immediately (always true)', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const onGrant = vi.fn();
        c.client.guard('necessary', onGrant);
        expect(onGrant).toHaveBeenCalledTimes(1);
    });

    it('without onRevoke stops watching after grant', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const onGrant = vi.fn();
        c.client.guard('analytics', onGrant);
        c.client.set({ analytics: true });
        expect(onGrant).toHaveBeenCalledTimes(1);
        // Subsequent changes should not trigger anything
        c.client.set({ analytics: false });
        c.client.set({ analytics: true });
        expect(onGrant).toHaveBeenCalledTimes(1);
    });
});

// ============================================================
// 10. Unified top-level API
// ============================================================
describe('unified top-level API', () => {
    beforeEach(clearAllCookies);

    it('get() delegates to client.get()', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        expect(c.get()).toEqual({ decision: 'unset' });
        c.client.set({ analytics: true });
        expect(c.get().decision).toBe('decided');
    });

    it('get(cookieHeader) delegates to server.get()', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const snapshot = {
            policy: c.policy.identifier,
            givenAt: new Date().toISOString(),
            choices: { necessary: true, analytics: true },
        };
        const header = `consentify=${enc(snapshot)}`;
        const state = c.get(header);
        expect(state.decision).toBe('decided');
    });

    it('get(null) falls through to client.get()', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        expect(c.get(null)).toEqual({ decision: 'unset' });
    });

    it('get("") delegates to server.get() and returns unset', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        expect(c.get('')).toEqual({ decision: 'unset' });
    });

    it('isGranted("analytics") returns correct boolean', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        expect(c.isGranted('analytics')).toBe(false);
        c.client.set({ analytics: true });
        expect(c.isGranted('analytics')).toBe(true);
    });

    it('isGranted("necessary") always returns true', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        expect(c.isGranted('necessary')).toBe(true);
    });

    it('set(choices) delegates to client.set()', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        c.set({ analytics: true });
        expect(c.client.get('analytics')).toBe(true);
    });

    it('set(choices, cookieHeader) returns Set-Cookie string', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const result = c.set({ analytics: true }, '');
        expect(typeof result).toBe('string');
        expect(result).toContain('consentify=');
    });

    it('clear() delegates to client.clear()', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        c.client.set({ analytics: true });
        expect(c.get().decision).toBe('decided');
        c.clear();
        expect(c.get()).toEqual({ decision: 'unset' });
    });

    it('clear(cookieHeader) returns clearing header', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const result = c.clear('somecookie=value');
        expect(typeof result).toBe('string');
        expect(result).toContain('Max-Age=0');
    });

    it('subscribe(cb) works at top level', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const cb = vi.fn();
        const unsub = c.subscribe(cb);
        c.set({ analytics: true });
        expect(cb).toHaveBeenCalledTimes(1);
        unsub();
        c.set({ analytics: false });
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('guard() works at top level', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const onGrant = vi.fn();
        c.guard('analytics', onGrant);
        expect(onGrant).not.toHaveBeenCalled();
        c.set({ analytics: true });
        expect(onGrant).toHaveBeenCalledTimes(1);
    });

    it('getServerSnapshot() returns unset', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        expect(c.getServerSnapshot()).toEqual({ decision: 'unset' });
    });
});

// ============================================================
// 11. enableConsentMode (Google Consent Mode v2)
// ============================================================

function findGtagCall(action: string, type: string): Record<string, unknown> | undefined {
    for (const entry of window.dataLayer as any[]) {
        const args = Array.from(entry);
        if (args[0] === action && args[1] === type) {
            return args[2] as Record<string, unknown>;
        }
    }
    return undefined;
}

function countGtagCalls(action: string, type: string): number {
    let count = 0;
    for (const entry of window.dataLayer as any[]) {
        const args = Array.from(entry);
        if (args[0] === action && args[1] === type) count++;
    }
    return count;
}

describe('enableConsentMode', () => {
    let consent: ReturnType<typeof createConsentify<readonly ['analytics', 'marketing', 'preferences']>>;

    beforeEach(() => {
        delete (window as any).dataLayer;
        delete (window as any).gtag;
        clearAllCookies();
        localStorage.clear();

        consent = createConsentify({
            policy: { categories: ['analytics', 'marketing', 'preferences'] as const },
        });
    });

    it('returns no-op dispose and makes no gtag calls in SSR', () => {
        const origWindow = globalThis.window;
        Object.defineProperty(globalThis, 'window', { value: undefined, configurable: true });

        const dispose = enableConsentMode(consent, {
            mapping: { analytics: ['analytics_storage'] },
        });

        expect(dispose).toBeTypeOf('function');
        dispose();

        Object.defineProperty(globalThis, 'window', { value: origWindow, configurable: true });
    });

    it('bootstraps dataLayer and gtag if missing', () => {
        expect(window.dataLayer).toBeUndefined();
        expect(window.gtag).toBeUndefined();

        enableConsentMode(consent, {
            mapping: { analytics: ['analytics_storage'] },
        });

        expect(Array.isArray(window.dataLayer)).toBe(true);
        expect(typeof window.gtag).toBe('function');
    });

    it('preserves existing dataLayer and gtag', () => {
        const existingData = [{ event: 'existing' }];
        window.dataLayer = existingData;
        const customGtag = vi.fn(function gtag() { window.dataLayer.push(arguments); });
        window.gtag = customGtag;

        enableConsentMode(consent, {
            mapping: { analytics: ['analytics_storage'] },
        });

        expect(window.dataLayer[0]).toEqual({ event: 'existing' });
        expect(customGtag).toHaveBeenCalled();
    });

    it('calls gtag consent default on init with mapped types as denied', () => {
        enableConsentMode(consent, {
            mapping: {
                analytics: ['analytics_storage'],
                marketing: ['ad_storage', 'ad_user_data', 'ad_personalization'],
            },
        });

        const defaultCall = findGtagCall('consent', 'default');
        expect(defaultCall).toBeDefined();
        expect(defaultCall!.analytics_storage).toBe('denied');
        expect(defaultCall!.ad_storage).toBe('denied');
        expect(defaultCall!.ad_user_data).toBe('denied');
        expect(defaultCall!.ad_personalization).toBe('denied');
    });

    it('passes wait_for_update in default call when provided', () => {
        enableConsentMode(consent, {
            mapping: { analytics: ['analytics_storage'] },
            waitForUpdate: 500,
        });

        const defaultCall = findGtagCall('consent', 'default');
        expect(defaultCall).toBeDefined();
        expect(defaultCall!.wait_for_update).toBe(500);
    });

    it('does not include wait_for_update when not provided', () => {
        enableConsentMode(consent, {
            mapping: { analytics: ['analytics_storage'] },
        });

        const defaultCall = findGtagCall('consent', 'default');
        expect(defaultCall).toBeDefined();
        expect(defaultCall!).not.toHaveProperty('wait_for_update');
    });

    it('calls both default and update if consent already decided', () => {
        consent.set({ analytics: true, marketing: false });

        enableConsentMode(consent, {
            mapping: {
                analytics: ['analytics_storage'],
                marketing: ['ad_storage'],
            },
        });

        expect(countGtagCalls('consent', 'default')).toBe(1);
        expect(countGtagCalls('consent', 'update')).toBe(1);

        const updateCall = findGtagCall('consent', 'update');
        expect(updateCall!.analytics_storage).toBe('granted');
        expect(updateCall!.ad_storage).toBe('denied');
    });

    it('only calls default if consent is unset', () => {
        enableConsentMode(consent, {
            mapping: { analytics: ['analytics_storage'] },
        });

        expect(countGtagCalls('consent', 'default')).toBe(1);
        expect(countGtagCalls('consent', 'update')).toBe(0);
    });

    it('calls gtag consent update on set()', () => {
        enableConsentMode(consent, {
            mapping: {
                analytics: ['analytics_storage'],
                marketing: ['ad_storage', 'ad_user_data'],
            },
        });

        consent.set({ analytics: true, marketing: false });

        const updateCalls = (window.dataLayer as any[]).filter(entry => {
            const args = Array.from(entry);
            return args[0] === 'consent' && args[1] === 'update';
        });

        expect(updateCalls.length).toBeGreaterThanOrEqual(1);
        const lastUpdate = Array.from(updateCalls[updateCalls.length - 1]) as unknown[];
        const payload = lastUpdate[2] as Record<string, string>;
        expect(payload.analytics_storage).toBe('granted');
        expect(payload.ad_storage).toBe('denied');
        expect(payload.ad_user_data).toBe('denied');
    });

    it('maps multiple categories correctly', () => {
        enableConsentMode(consent, {
            mapping: {
                analytics: ['analytics_storage'],
                marketing: ['ad_storage'],
                preferences: ['functionality_storage', 'personalization_storage'],
            },
        });

        consent.set({ analytics: true, marketing: false, preferences: true });

        const updateCalls = (window.dataLayer as any[]).filter(entry => {
            const args = Array.from(entry);
            return args[0] === 'consent' && args[1] === 'update';
        });
        const lastUpdate = Array.from(updateCalls[updateCalls.length - 1]) as unknown[];
        const payload = lastUpdate[2] as Record<string, string>;

        expect(payload.analytics_storage).toBe('granted');
        expect(payload.ad_storage).toBe('denied');
        expect(payload.functionality_storage).toBe('granted');
        expect(payload.personalization_storage).toBe('granted');
    });

    it('maps necessary to granted always', () => {
        enableConsentMode(consent, {
            mapping: {
                necessary: ['security_storage'],
                analytics: ['analytics_storage'],
            },
        });

        const defaultCall = findGtagCall('consent', 'default');
        expect(defaultCall!.security_storage).toBe('granted');
        expect(defaultCall!.analytics_storage).toBe('denied');
    });

    it('dispose stops future updates', () => {
        const dispose = enableConsentMode(consent, {
            mapping: { analytics: ['analytics_storage'] },
        });

        dispose();

        const countBefore = countGtagCalls('consent', 'update');
        consent.set({ analytics: true });
        const countAfter = countGtagCalls('consent', 'update');

        expect(countAfter).toBe(countBefore);
    });

    it('handles clear() (consent revoked)', () => {
        enableConsentMode(consent, {
            mapping: { analytics: ['analytics_storage'] },
        });

        consent.set({ analytics: true });
        const updatesBefore = countGtagCalls('consent', 'update');

        consent.clear();

        const updatesAfter = countGtagCalls('consent', 'update');
        expect(updatesAfter).toBe(updatesBefore);
    });

    it('survives a throwing gtag and still subscribes', () => {
        window.dataLayer = [];
        window.gtag = vi.fn(() => { throw new Error('gtag broke'); });
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const dispose = enableConsentMode(consent, {
            mapping: { analytics: ['analytics_storage'] },
        });

        // Should not throw — safeGtag catches it
        expect(spy).toHaveBeenCalledWith(
            '[consentify] gtag call failed:',
            expect.any(Error),
        );

        // Subscription should still work — replace gtag with a working one
        window.gtag = function gtag() { window.dataLayer.push(arguments); };
        consent.set({ analytics: true });
        expect(countGtagCalls('consent', 'update')).toBeGreaterThanOrEqual(1);

        dispose();
        spy.mockRestore();
    });

    it('works with a minimal ConsentifySubscribable (not a full instance)', () => {
        let state: ConsentState<'analytics'> = { decision: 'unset' };
        const listeners = new Set<() => void>();
        const subscribable: ConsentifySubscribable<'analytics'> = {
            subscribe: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
            get: () => state,
            getServerSnapshot: () => ({ decision: 'unset' }),
        };

        const dispose = enableConsentMode(subscribable, {
            mapping: { analytics: ['analytics_storage'] },
        });

        // Default call should have been made with denied
        const defaultCall = findGtagCall('consent', 'default');
        expect(defaultCall).toBeDefined();
        expect(defaultCall!.analytics_storage).toBe('denied');

        // Simulate consent decision
        state = {
            decision: 'decided',
            snapshot: {
                policy: 'x',
                givenAt: new Date().toISOString(),
                choices: { necessary: true, analytics: true },
            },
        };
        listeners.forEach(cb => cb());

        const updateCall = findGtagCall('consent', 'update');
        expect(updateCall).toBeDefined();
        expect(updateCall!.analytics_storage).toBe('granted');

        dispose();
    });
});

// ============================================================
// 12. Server API — merge & cookie config
// ============================================================
describe('server API — merge & cookie config', () => {
    it('server.set() merges with existing consent from currentCookieHeader', () => {
        const c = createConsentify({ policy: { categories: ['analytics', 'marketing'] as const } });
        // First, set analytics via server
        const header1 = c.server.set({ analytics: true });
        const cookieVal = header1.split(';')[0]; // "consentify=..."
        // Now set marketing, passing existing cookie
        const header2 = c.server.set({ marketing: true }, cookieVal);
        const val = header2.split(';')[0].split('=').slice(1).join('=');
        const snapshot = JSON.parse(decodeURIComponent(val));
        expect(snapshot.choices.analytics).toBe(true);
        expect(snapshot.choices.marketing).toBe(true);
    });

    it('SameSite=None forces Secure flag in server headers', () => {
        const c = createConsentify({
            policy: { categories: ['analytics'] },
            cookie: { sameSite: 'None', secure: false },
        });
        const header = c.server.set({ analytics: true });
        expect(header).toContain('SameSite=None');
        expect(header).toContain('Secure');
    });

    it('domain option appears in Set-Cookie header', () => {
        const c = createConsentify({
            policy: { categories: ['analytics'] },
            cookie: { domain: '.example.com' },
        });
        const header = c.server.set({ analytics: true });
        expect(header).toContain('Domain=.example.com');
    });

    it('domain option appears in clear header', () => {
        const c = createConsentify({
            policy: { categories: ['analytics'] },
            cookie: { domain: '.example.com' },
        });
        const header = c.server.clear();
        expect(header).toContain('Domain=.example.com');
    });

    it('clear() returns the same header regardless of input', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const result1 = c.clear('foo=bar');
        const result2 = c.clear('baz=qux');
        expect(result1).toBe(result2);
    });
});

// ============================================================
// 13. Multi-tab sync (BroadcastChannel)
// ============================================================
describe('multi-tab sync (BroadcastChannel)', () => {
    beforeEach(() => {
        clearAllCookies();
        MockBroadcastChannel.channels.clear();
        vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        MockBroadcastChannel.channels.clear();
    });

    it('set() in one instance notifies listeners in another', () => {
        const c1 = createConsentify({ policy: { categories: ['analytics'] as const } });
        const c2 = createConsentify({ policy: { categories: ['analytics'] as const } });
        const listener = vi.fn();
        c2.client.subscribe(listener);

        c1.client.set({ analytics: true });

        expect(listener).toHaveBeenCalled();
    });

    it('receiving instance has updated state after set()', () => {
        const c1 = createConsentify({ policy: { categories: ['analytics'] as const } });
        const c2 = createConsentify({ policy: { categories: ['analytics'] as const } });

        c1.client.set({ analytics: true });

        expect(c2.client.get('analytics')).toBe(true);
    });

    it('clear() in one instance notifies listeners in another', () => {
        const c1 = createConsentify({ policy: { categories: ['analytics'] as const } });
        const c2 = createConsentify({ policy: { categories: ['analytics'] as const } });
        c1.client.set({ analytics: true });
        const listener = vi.fn();
        c2.client.subscribe(listener);

        c1.client.clear();

        expect(listener).toHaveBeenCalled();
        expect(c2.client.get()).toEqual({ decision: 'unset' });
    });

    it('initiating instance does not double-fire its own listeners', () => {
        const c1 = createConsentify({ policy: { categories: ['analytics'] as const } });
        // second instance just to have a channel peer
        createConsentify({ policy: { categories: ['analytics'] as const } });
        const listener = vi.fn();
        c1.client.subscribe(listener);

        c1.client.set({ analytics: true });

        // Fires exactly once from the local notifyListeners(), not again from BroadcastChannel
        expect(listener).toHaveBeenCalledTimes(1);
    });
});

// ============================================================
// 17. Typed event system (on / once)
// ============================================================
describe('event system (on / once)', () => {
    beforeEach(() => { clearAllCookies(); localStorage.clear(); });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('on("change") fires with from/to/timestamp on set()', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const handler = vi.fn();
        c.on('change', handler);

        c.client.set({ analytics: true });

        expect(handler).toHaveBeenCalledOnce();
        const event = handler.mock.calls[0][0];
        expect(event.from).toEqual({ decision: 'unset' });
        expect(event.to.decision).toBe('decided');
        expect(event.to.snapshot.choices.analytics).toBe(true);
        expect(event.timestamp).toBeTypeOf('number');
    });

    it('on("clear") fires with timestamp on clear()', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        c.client.set({ analytics: true });
        const handler = vi.fn();
        c.on('clear', handler);

        c.client.clear();

        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0][0].timestamp).toBeTypeOf('number');
    });

    it('clear does not fire event when state was already unset', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const handler = vi.fn();
        c.on('clear', handler);

        c.client.clear();

        expect(handler).not.toHaveBeenCalled();
    });

    it('once() fires once then auto-unsubscribes', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const handler = vi.fn();
        c.once('change', handler);

        c.client.set({ analytics: true });
        c.client.set({ analytics: false });

        expect(handler).toHaveBeenCalledOnce();
    });

    it('unsubscribe from on() stops handler', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const handler = vi.fn();
        const unsub = c.on('change', handler);

        unsub();
        c.client.set({ analytics: true });

        expect(handler).not.toHaveBeenCalled();
    });

    it('handler error does not break other handlers', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const bad = vi.fn(() => { throw new Error('boom'); });
        const good = vi.fn();

        c.on('change', bad);
        c.on('change', good);

        c.client.set({ analytics: true });

        expect(bad).toHaveBeenCalledOnce();
        expect(good).toHaveBeenCalledOnce();
    });

    it('multiple handlers on same event all fire', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const h1 = vi.fn();
        const h2 = vi.fn();
        const h3 = vi.fn();

        c.on('change', h1);
        c.on('change', h2);
        c.on('change', h3);

        c.client.set({ analytics: true });

        expect(h1).toHaveBeenCalledOnce();
        expect(h2).toHaveBeenCalledOnce();
        expect(h3).toHaveBeenCalledOnce();
    });

    it('change event captures correct from state on sequential changes', () => {
        const c = createConsentify({ policy: { categories: ['analytics', 'marketing'] as const } });
        const handler = vi.fn();
        c.on('change', handler);

        c.client.set({ analytics: true });
        c.client.set({ marketing: true });

        expect(handler).toHaveBeenCalledTimes(2);
        // First call: unset -> analytics:true
        expect(handler.mock.calls[0][0].from.decision).toBe('unset');
        // Second call: decided -> decided (with marketing added)
        expect(handler.mock.calls[1][0].from.decision).toBe('decided');
        expect(handler.mock.calls[1][0].to.snapshot.choices.marketing).toBe(true);
    });
});

// ============================================================
// 18. enableDebug adapter
// ============================================================
describe('enableDebug', () => {
    beforeEach(() => { clearAllCookies(); localStorage.clear(); });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('logs on change with default logger', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        enableDebug(c);

        c.client.set({ analytics: true });

        expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining('[consentify] Consent changed'),
            expect.objectContaining({ timestamp: expect.any(Number) }),
        );
        logSpy.mockRestore();
    });

    it('logs on clear with default logger', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        enableDebug(c);
        c.client.set({ analytics: true });
        logSpy.mockClear();

        c.client.clear();

        expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining('[consentify] Consent cleared'),
            expect.objectContaining({ timestamp: expect.any(Number) }),
        );
        logSpy.mockRestore();
    });

    it('custom onLog handler receives events', () => {
        const onLog = vi.fn();
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        enableDebug(c, { onLog });

        c.client.set({ analytics: true });

        expect(onLog).toHaveBeenCalledWith('Consent changed', expect.objectContaining({ timestamp: expect.any(Number) }));
    });

    it('unsubscribe stops logging', () => {
        const onLog = vi.fn();
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const unsub = enableDebug(c, { onLog });

        unsub();
        c.client.set({ analytics: true });

        expect(onLog).not.toHaveBeenCalled();
    });
});

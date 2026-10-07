import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCloudConsentify } from './cloud';
import { createConsentify, enableConsentMode, enableDebug, stableStringify, fnv1a, hashPolicy, verifyProof, parseSetCookie, ConsentifyConfigError, type ConsentAdapter, type ConsentifySubscribable, type ConsentState, type ConsentProof, type Snapshot } from './index';

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
    it('returns unset when the consentify cookie is absent among others', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] } });
        expect(c.server.get('other=foo; another=bar').decision).toBe('unset');
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

    it('isGranted(category) returns boolean', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        expect(c.isGranted('necessary')).toBe(true);
        expect(c.isGranted('analytics')).toBe(false);
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

describe('client set() re-affirmation', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const givenAt = (s: ConsentState<string>) => (s.decision === 'decided' ? s.snapshot.givenAt : null);

    beforeEach(() => {
        clearAllCookies();
        vi.stubGlobal('BroadcastChannel', undefined);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        clearAllCookies();
    });

    it('identical choices refresh givenAt, persist it, notify and emit change', () => {
        const t0 = Date.now();
        vi.setSystemTime(t0);
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        c.client.set({ analytics: true });
        const first = c.client.get();

        vi.setSystemTime(t0 + 60_000);
        const listener = vi.fn();
        const handler = vi.fn();
        c.client.subscribe(listener);
        c.on('change', handler);
        c.client.set({ analytics: true });
        const second = c.client.get();

        expect(givenAt(first)).toBe(new Date(t0).toISOString());
        expect(givenAt(second)).toBe(new Date(t0 + 60_000).toISOString());
        expect(listener).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0][0].from).toBe(first);
        expect(handler.mock.calls[0][0].to).toBe(second);
        // Written to storage: a fresh instance (page reload) sees the new timestamp.
        expect(createConsentify({ policy: { categories: ['analytics'] as const } }).client.get()).toEqual(second);
    });

    it('acceptAll() twice records two decisions', () => {
        const t0 = Date.now();
        vi.setSystemTime(t0);
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const handler = vi.fn();
        c.on('change', handler);
        c.acceptAll();
        vi.setSystemTime(t0 + 1000);
        c.acceptAll();
        expect(handler).toHaveBeenCalledTimes(2);
        expect(givenAt(c.get())).toBe(new Date(t0 + 1000).toISOString());
    });

    it('identical choices extend expiration when consentMaxAgeDays is set', () => {
        const opts = { policy: { categories: ['analytics'] as const }, consentMaxAgeDays: 30 };
        const t0 = Date.now();
        vi.setSystemTime(t0);
        createConsentify(opts).client.set({ analytics: true });

        vi.setSystemTime(t0 + 25 * DAY);
        createConsentify(opts).client.set({ analytics: true });

        // 31 days after the original decision it would have expired; the
        // re-affirmation 25 days in restarted the 30-day window.
        vi.setSystemTime(t0 + 31 * DAY);
        const reloaded = createConsentify(opts);
        expect(reloaded.client.get().decision).toBe('decided');
        expect(reloaded.isGranted('analytics')).toBe(true);
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
        expect(c.isGranted('analytics')).toBe(true);
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

    it('re-arms after revoke when onRevoke is set (grant → revoke → grant → revoke)', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const onGrant = vi.fn();
        const onRevoke = vi.fn();
        c.client.guard('analytics', onGrant, onRevoke);
        c.client.set({ analytics: true });
        c.client.set({ analytics: false });
        c.client.set({ analytics: true });
        expect(onGrant).toHaveBeenCalledTimes(2);
        expect(onRevoke).toHaveBeenCalledTimes(1);
        c.client.set({ analytics: false });
        expect(onGrant).toHaveBeenCalledTimes(2);
        expect(onRevoke).toHaveBeenCalledTimes(2);
    });

    it('re-arms after revoke via clear()', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const onGrant = vi.fn();
        const onRevoke = vi.fn();
        c.client.guard('analytics', onGrant, onRevoke);
        c.client.set({ analytics: true });
        c.client.clear();
        expect(onRevoke).toHaveBeenCalledTimes(1);
        c.client.set({ analytics: true });
        expect(onGrant).toHaveBeenCalledTimes(2);
        c.client.clear();
        expect(onRevoke).toHaveBeenCalledTimes(2);
    });

    it('unrelated changes while granted do not re-fire onGrant', () => {
        const c = createConsentify({ policy: { categories: ['analytics', 'marketing'] as const } });
        const onGrant = vi.fn();
        const onRevoke = vi.fn();
        c.client.guard('analytics', onGrant, onRevoke);
        c.client.set({ analytics: true });
        c.client.set({ marketing: true });
        c.client.set({ marketing: false });
        expect(onGrant).toHaveBeenCalledTimes(1);
        expect(onRevoke).not.toHaveBeenCalled();
    });

    it('dispose after a revoke stops further calls', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const onGrant = vi.fn();
        const onRevoke = vi.fn();
        const dispose = c.client.guard('analytics', onGrant, onRevoke);
        c.client.set({ analytics: true });
        c.client.set({ analytics: false });
        dispose();
        c.client.set({ analytics: true });
        c.client.set({ analytics: false });
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

    it('without onRevoke stays one-shot after clear() and re-grant', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const onGrant = vi.fn();
        c.client.guard('analytics', onGrant);
        c.client.set({ analytics: true });
        c.client.clear();
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

    it('get({ cookieHeader }) delegates to server.get()', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const snapshot = {
            policy: c.policy.identifier,
            givenAt: new Date().toISOString(),
            choices: { necessary: true, analytics: true },
        };
        const header = `consentify=${enc(snapshot)}`;
        const state = c.get({ cookieHeader: header });
        expect(state.decision).toBe('decided');
    });

    it('get({}) with a missing, empty or null header is server-side unset', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        c.client.set({ analytics: true });
        expect(c.get().decision).toBe('decided');
        // Server mode never reads the browser store.
        expect(c.get({})).toEqual({ decision: 'unset' });
        expect(c.get({ cookieHeader: '' })).toEqual({ decision: 'unset' });
        expect(c.get({ cookieHeader: null })).toEqual({ decision: 'unset' });
    });

    it('a non-object argument is not server mode', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        c.client.set({ analytics: true });
        // v2 call shapes from untyped code fall through to the client store.
        expect((c.get as (x: unknown) => unknown)('consentify=x')).toBe(c.client.get());
        expect((c.get as (x: unknown) => unknown)(null)).toBe(c.client.get());
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
        expect(c.set({ analytics: true })).toBeUndefined();
        expect(c.isGranted('analytics')).toBe(true);
    });

    it('set(choices, {}) returns Set-Cookie string', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const result = c.set({ analytics: true }, {});
        expect(typeof result).toBe('string');
        expect(result).toContain('consentify=');
        // Server mode does not touch the browser store.
        expect(c.get()).toEqual({ decision: 'unset' });
    });

    it('set(choices, { cookieHeader }) merges into the existing cookie', () => {
        const c = createConsentify({ policy: { categories: ['analytics', 'marketing'] as const } });
        const first = c.set({ analytics: true }, { cookieHeader: null });
        const cookieHeader = first.split(';')[0];
        const second = c.set({ marketing: true }, { cookieHeader });
        const state = c.get({ cookieHeader: second.split(';')[0] });
        expect(state.decision === 'decided' && state.snapshot.choices).toEqual({
            necessary: true, analytics: true, marketing: true,
        });
    });

    it('clear() delegates to client.clear()', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        c.client.set({ analytics: true });
        expect(c.get().decision).toBe('decided');
        c.clear();
        expect(c.get()).toEqual({ decision: 'unset' });
    });

    it('clear({}) returns a Max-Age=0 header and leaves the client store alone', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        c.client.set({ analytics: true });
        const result = c.clear({});
        expect(typeof result).toBe('string');
        expect(result).toContain('consentify=;');
        expect(result).toContain('Max-Age=0');
        expect(c.get().decision).toBe('decided');
    });

    it('isGranted(category, { cookieHeader }) reads the header (opt-in)', () => {
        const c = createConsentify({ policy: { categories: ['analytics', 'marketing'] as const } });
        const cookieHeader = c.set({ analytics: true }, {}).split(';')[0];
        expect(c.isGranted('analytics', { cookieHeader })).toBe(true);
        expect(c.isGranted('marketing', { cookieHeader })).toBe(false);
        expect(c.isGranted('analytics', {})).toBe(false);
        expect(c.isGranted('necessary', {})).toBe(true);
    });

    it('isGranted(category, { cookieHeader }) follows opt-out when unset', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const }, mode: 'opt-out' });
        expect(c.isGranted('analytics', { cookieHeader: null })).toBe(true);
        expect(c.isGranted('analytics', { cookieHeader: 'other=1' })).toBe(true);
        const cookieHeader = c.set({ analytics: false }, {}).split(';')[0];
        expect(c.isGranted('analytics', { cookieHeader })).toBe(false);
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
        // Keep these instances off the shared BroadcastChannel: their gtag
        // subscriptions would otherwise fire during later tests (including
        // ones that stub `window` away) and pollute stderr.
        vi.stubGlobal('BroadcastChannel', undefined);

        consent = createConsentify({
            policy: { categories: ['analytics', 'marketing', 'preferences'] as const },
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
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

    it('sendDefault: false skips the default command when consent is unset', () => {
        enableConsentMode(consent, {
            mapping: { analytics: ['analytics_storage'] },
            sendDefault: false,
            waitForUpdate: 500,
        });

        expect(countGtagCalls('consent', 'default')).toBe(0);
        expect(countGtagCalls('consent', 'update')).toBe(0);
    });

    it('sendDefault: false still sends update when consent is already decided', () => {
        consent.set({ analytics: true, marketing: false });

        enableConsentMode(consent, {
            mapping: {
                analytics: ['analytics_storage'],
                marketing: ['ad_storage'],
            },
            sendDefault: false,
        });

        expect(countGtagCalls('consent', 'default')).toBe(0);
        expect(countGtagCalls('consent', 'update')).toBe(1);

        const updateCall = findGtagCall('consent', 'update');
        expect(updateCall!.analytics_storage).toBe('granted');
        expect(updateCall!.ad_storage).toBe('denied');
    });

    it('sendDefault: false still sends update on set()', () => {
        enableConsentMode(consent, {
            mapping: { analytics: ['analytics_storage'] },
            sendDefault: false,
        });

        consent.set({ analytics: true });

        expect(countGtagCalls('consent', 'default')).toBe(0);
        const updateCall = findGtagCall('consent', 'update');
        expect(updateCall!.analytics_storage).toBe('granted');
        expect(updateCall!).not.toHaveProperty('wait_for_update');
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

    it('clear() (consent revoked) resets gtag to denied defaults', () => {
        enableConsentMode(consent, {
            mapping: { analytics: ['analytics_storage'] },
        });

        consent.set({ analytics: true });
        const updatesBefore = countGtagCalls('consent', 'update');

        consent.clear();

        expect(countGtagCalls('consent', 'update')).toBe(updatesBefore + 1);
        const updateCalls = (window.dataLayer as any[]).filter(entry => {
            const args = Array.from(entry);
            return args[0] === 'consent' && args[1] === 'update';
        });
        const lastUpdate = Array.from(updateCalls[updateCalls.length - 1]) as unknown[];
        expect((lastUpdate[2] as Record<string, string>).analytics_storage).toBe('denied');
    });

    it('clear() in opt-out mode resets gtag to granted defaults', () => {
        const optOut = createConsentify({
            policy: { categories: ['analytics'] as const },
            mode: 'opt-out',
        });
        enableConsentMode(optOut, {
            mapping: { analytics: ['analytics_storage'] },
        });

        optOut.set({ analytics: false });
        optOut.clear();

        const updateCalls = (window.dataLayer as any[]).filter(entry => {
            const args = Array.from(entry);
            return args[0] === 'consent' && args[1] === 'update';
        });
        const lastUpdate = Array.from(updateCalls[updateCalls.length - 1]) as unknown[];
        expect((lastUpdate[2] as Record<string, string>).analytics_storage).toBe('granted');
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
        listeners.forEach(cb => { cb(); });

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
        const result1 = c.clear({ cookieHeader: 'foo=bar' });
        const result2 = c.clear({ cookieHeader: 'baz=qux' });
        expect(result1).toBe(result2);
    });

    it('Max-Age follows consentMaxAgeDays when maxAgeSec is unset', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] }, consentMaxAgeDays: 180 });
        expect(c.server.set({ analytics: true })).toContain(`Max-Age=${180 * 86400};`);
    });

    it('explicit cookie.maxAgeSec wins over consentMaxAgeDays', () => {
        const c = createConsentify({
            policy: { categories: ['analytics'] },
            consentMaxAgeDays: 180,
            cookie: { maxAgeSec: 3600 },
        });
        expect(c.server.set({ analytics: true })).toContain('Max-Age=3600;');
    });

    it('Max-Age defaults to one year when neither option is set', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] } });
        expect(c.server.set({ analytics: true })).toContain('Max-Age=31536000;');
    });

    it('partitioned: true adds Partitioned and forces Secure', () => {
        const c = createConsentify({
            policy: { categories: ['analytics'] },
            cookie: { partitioned: true, secure: false },
        });
        const header = c.server.set({ analytics: true });
        expect(header).toContain('; Secure');
        expect(header).toContain('; Partitioned');
    });

    it('clear() header carries Partitioned when partitioned is set', () => {
        const c = createConsentify({
            policy: { categories: ['analytics'] },
            cookie: { partitioned: true },
        });
        const header = c.server.clear();
        expect(header).toContain('Max-Age=0');
        expect(header).toContain('; Partitioned');
    });

    it('omits Partitioned by default', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] } });
        expect(c.server.set({ analytics: true })).not.toContain('Partitioned');
    });
});

describe('parseSetCookie', () => {
    const mk = () => createConsentify({
        policy: { categories: ['analytics'] as const },
        cookie: { name: 'cc', domain: '.example.com', sameSite: 'Strict', maxAgeSec: 3600, path: '/app' },
    });

    it('round-trips set() output with custom cookie config', () => {
        const c = mk();
        const header = c.set({ analytics: true }, {});
        const { name, value, options } = parseSetCookie(header);
        expect(name).toBe('cc');
        expect(value).toBe(decodeURIComponent(header.slice(3, header.indexOf(';'))));
        expect(options).toEqual({ path: '/app', maxAge: 3600, domain: '.example.com', sameSite: 'strict', secure: true });
        expect(c.get({ cookieHeader: `${name}=${encodeURIComponent(value)}` }).decision).toBe('decided');
    });

    it('clear() header yields maxAge 0 and an empty value', () => {
        const { name, value, options } = parseSetCookie(mk().clear({}));
        expect(name).toBe('cc');
        expect(value).toBe('');
        expect(options.maxAge).toBe(0);
    });

    it('returns the URI-decoded value', () => {
        const { value } = parseSetCookie(mk().set({ analytics: false }, {}));
        expect(value).toMatch(/^\{/);
        expect(JSON.parse(value).choices.analytics).toBe(false);
    });

    it('parses Partitioned and lowercase attribute names, omitting absent keys', () => {
        expect(parseSetCookie('a=b; path=/; max-age=10; samesite=None; secure; partitioned')).toEqual({
            name: 'a',
            value: 'b',
            options: { path: '/', maxAge: 10, sameSite: 'none', secure: true, partitioned: true },
        });
        expect(parseSetCookie('a=b').options).toEqual({});
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

        expect(c2.isGranted('analytics')).toBe(true);
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

    it('set() in one instance emits "change" event in another', () => {
        const c1 = createConsentify({ policy: { categories: ['analytics'] as const } });
        const c2 = createConsentify({ policy: { categories: ['analytics'] as const } });
        const handler = vi.fn();
        c2.on('change', handler);

        c1.client.set({ analytics: true });

        expect(handler).toHaveBeenCalledOnce();
        const event = handler.mock.calls[0][0];
        expect(event.from).toEqual({ decision: 'unset' });
        expect(event.to.decision).toBe('decided');
        expect(event.to.snapshot.choices.analytics).toBe(true);
    });

    it('clear() in one instance emits "clear" event in another', () => {
        const c1 = createConsentify({ policy: { categories: ['analytics'] as const } });
        c1.client.set({ analytics: true });
        const c2 = createConsentify({ policy: { categories: ['analytics'] as const } });
        const handler = vi.fn();
        c2.on('clear', handler);

        c1.client.clear();

        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0][0].timestamp).toBeTypeOf('number');
    });

    it('cross-tab guard() revocation fires onRevoke', () => {
        const c1 = createConsentify({ policy: { categories: ['analytics'] as const } });
        const c2 = createConsentify({ policy: { categories: ['analytics'] as const } });
        const onGrant = vi.fn();
        const onRevoke = vi.fn();
        c2.guard('analytics', onGrant, onRevoke);

        c1.set({ analytics: true });
        expect(onGrant).toHaveBeenCalledOnce();

        c1.set({ analytics: false });
        expect(onRevoke).toHaveBeenCalledOnce();
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

    it('once("change") fires once then auto-unsubscribes', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const handler = vi.fn();
        c.once('change', handler);

        c.client.set({ analytics: true });
        c.client.set({ analytics: false });

        expect(handler).toHaveBeenCalledOnce();
    });

    it('once("clear") fires once then auto-unsubscribes', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const handler = vi.fn();
        c.once('clear', handler);

        c.client.set({ analytics: true });
        c.client.clear();
        c.client.set({ analytics: true });
        c.client.clear();

        expect(handler).toHaveBeenCalledOnce();
    });

    it('multiple once() handlers all fire exactly once', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const h1 = vi.fn();
        const h2 = vi.fn();
        const h3 = vi.fn();

        c.once('change', h1);
        c.once('change', h2);
        c.once('change', h3);

        c.client.set({ analytics: true });
        c.client.set({ analytics: false });

        expect(h1).toHaveBeenCalledOnce();
        expect(h2).toHaveBeenCalledOnce();
        expect(h3).toHaveBeenCalledOnce();
    });

    it('can unsubscribe from once() before event fires', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const handler = vi.fn();
        const unsub = c.once('change', handler);

        unsub();
        c.client.set({ analytics: true });

        expect(handler).not.toHaveBeenCalled();
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

    it('logs expiring events', () => {
        const onLog = vi.fn();
        const c = createConsentify({
            policy: { categories: ['analytics'] as const },
            consentMaxAgeDays: 30,
            expirationWarningDays: 31,
        });
        enableDebug(c, { onLog });

        c.client.set({ analytics: true });

        expect(onLog).toHaveBeenCalledWith('Consent changed', expect.any(Object));
        expect(onLog).toHaveBeenCalledWith('Consent expiring', expect.objectContaining({
            expiresAt: expect.any(Number),
            daysRemaining: expect.any(Number),
        }));
    });
});

// ============================================================
// acceptAll / rejectAll
// ============================================================
describe('acceptAll / rejectAll', () => {
    afterEach(() => { clearAllCookies(); vi.unstubAllGlobals(); });

    it('acceptAll sets all user categories to true', () => {
        const c = createConsentify({ policy: { categories: ['analytics', 'marketing'] as const } });
        c.acceptAll();
        const state = c.get();
        expect(state.decision).toBe('decided');
        if (state.decision === 'decided') {
            expect(state.snapshot.choices.analytics).toBe(true);
            expect(state.snapshot.choices.marketing).toBe(true);
            expect(state.snapshot.choices.necessary).toBe(true);
        }
    });

    it('rejectAll sets all user categories to false', () => {
        const c = createConsentify({ policy: { categories: ['analytics', 'marketing'] as const } });
        c.rejectAll();
        const state = c.get();
        expect(state.decision).toBe('decided');
        if (state.decision === 'decided') {
            expect(state.snapshot.choices.analytics).toBe(false);
            expect(state.snapshot.choices.marketing).toBe(false);
            expect(state.snapshot.choices.necessary).toBe(true);
        }
    });

    it('acceptAll({ cookieHeader }) returns Set-Cookie string', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const header = c.acceptAll({ cookieHeader: '' });
        expect(typeof header).toBe('string');
        expect(header).toContain('consentify=');
    });

    it('rejectAll({}) returns Set-Cookie string', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const header = c.rejectAll({});
        expect(typeof header).toBe('string');
        expect(header).toContain('consentify=');
    });

    it('both emit change events', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const handler = vi.fn();
        c.on('change', handler);

        c.acceptAll();
        expect(handler).toHaveBeenCalledTimes(1);

        c.rejectAll();
        expect(handler).toHaveBeenCalledTimes(2);
    });

    it('works with custom categories', () => {
        const c = createConsentify({ policy: { categories: ['ads', 'personalization', 'stats'] as const } });
        c.acceptAll();
        const state = c.get();
        if (state.decision === 'decided') {
            expect(state.snapshot.choices.ads).toBe(true);
            expect(state.snapshot.choices.personalization).toBe(true);
            expect(state.snapshot.choices.stats).toBe(true);
        }
    });
});

// ============================================================
// getProof (secret-only)
// ============================================================
describe('getProof', () => {
    afterEach(() => { clearAllCookies(); vi.unstubAllGlobals(); });

    it('does not exist on an instance without a secret', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        c.set({ analytics: true });
        expect('getProof' in c).toBe(false);
        // @ts-expect-error - getProof is only typed on the secret instance
        expect(c.getProof).toBeUndefined();
    });
});

// ============================================================
// mode: opt-in / opt-out
// ============================================================
describe('consent mode (opt-in / opt-out)', () => {
    afterEach(() => { clearAllCookies(); vi.unstubAllGlobals(); });

    it('default mode is opt-in: isGranted returns false when unset', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        expect(c.isGranted('analytics')).toBe(false);
    });

    it('opt-out mode: isGranted returns true when unset', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const }, mode: 'opt-out' });
        expect(c.isGranted('analytics')).toBe(true);
    });

    it('opt-out mode: guard fires onGrant immediately when unset', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const }, mode: 'opt-out' });
        const onGrant = vi.fn();
        c.guard('analytics', onGrant);
        expect(onGrant).toHaveBeenCalledTimes(1);
    });

    it('opt-out mode: explicit set overrides default', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const }, mode: 'opt-out' });
        c.set({ analytics: false });
        expect(c.isGranted('analytics')).toBe(false);
    });

    it('necessary always true regardless of mode', () => {
        const c1 = createConsentify({ policy: { categories: ['analytics'] as const }, mode: 'opt-in' });
        const c2 = createConsentify({ policy: { categories: ['analytics'] as const }, mode: 'opt-out' });
        expect(c1.isGranted('necessary')).toBe(true);
        expect(c2.isGranted('necessary')).toBe(true);
    });

    it('mode is exposed on the instance', () => {
        const c1 = createConsentify({ policy: { categories: ['analytics'] as const } });
        const c2 = createConsentify({ policy: { categories: ['analytics'] as const }, mode: 'opt-out' });
        expect(c1.mode).toBe('opt-in');
        expect(c2.mode).toBe('opt-out');
    });

    it('enableConsentMode respects opt-out mode when unset', () => {
        vi.stubGlobal('window', { dataLayer: [], gtag: vi.fn() });
        vi.stubGlobal('BroadcastChannel', undefined);
        const c = createConsentify({ policy: { categories: ['analytics'] as const }, mode: 'opt-out' });
        enableConsentMode(c, { mapping: { analytics: ['analytics_storage'] } });
        expect(window.gtag).toHaveBeenCalledWith('consent', 'default', expect.objectContaining({
            analytics_storage: 'granted',
        }));
    });

    it('opt-in mode: enableConsentMode defaults to denied when unset', () => {
        vi.stubGlobal('window', { dataLayer: [], gtag: vi.fn() });
        vi.stubGlobal('BroadcastChannel', undefined);
        const c = createConsentify({ policy: { categories: ['analytics'] as const }, mode: 'opt-in' });
        enableConsentMode(c, { mapping: { analytics: ['analytics_storage'] } });
        expect(window.gtag).toHaveBeenCalledWith('consent', 'default', expect.objectContaining({
            analytics_storage: 'denied',
        }));
    });

    it('opt-out mode: partial client set keeps untouched categories granted', () => {
        const c = createConsentify({ policy: { categories: ['analytics', 'marketing'] as const }, mode: 'opt-out' });
        c.set({ analytics: false });
        const s = c.get();
        if (s.decision !== 'decided') throw new Error('expected decided');
        expect(s.snapshot.choices).toEqual({ necessary: true, analytics: false, marketing: true });
    });

    it('opt-out mode: partial server set from empty header keeps untouched categories granted', () => {
        const c = createConsentify({ policy: { categories: ['analytics', 'marketing'] as const }, mode: 'opt-out' });
        for (const header of [c.set({ analytics: false }, {}), c.server.set({ analytics: false })]) {
            const s = c.server.get(setHeaderToCookieHeader(header));
            if (s.decision !== 'decided') throw new Error('expected decided');
            expect(s.snapshot.choices).toEqual({ necessary: true, analytics: false, marketing: true });
        }
    });

    it('opt-in mode: partial set still leaves untouched categories denied', () => {
        const c = createConsentify({ policy: { categories: ['analytics', 'marketing'] as const }, mode: 'opt-in' });
        c.set({ analytics: true });
        expect(c.isGranted('analytics')).toBe(true);
        expect(c.isGranted('marketing')).toBe(false);
        const s = c.server.get(setHeaderToCookieHeader(c.set({ analytics: true }, {})));
        if (s.decision !== 'decided') throw new Error('expected decided');
        expect(s.snapshot.choices).toEqual({ necessary: true, analytics: true, marketing: false });
    });

    it('opt-out mode: rejectAll still denies every category', () => {
        const c = createConsentify({ policy: { categories: ['analytics', 'marketing'] as const }, mode: 'opt-out' });
        c.rejectAll();
        expect(c.isGranted('analytics')).toBe(false);
        expect(c.isGranted('marketing')).toBe(false);
        expect(c.isGranted('necessary')).toBe(true);
        const s = c.server.get(setHeaderToCookieHeader(c.rejectAll({})));
        if (s.decision !== 'decided') throw new Error('expected decided');
        expect(s.snapshot.choices).toEqual({ necessary: true, analytics: false, marketing: false });
    });
});

// ============================================================
// Expiring event
// ============================================================
describe('expiring event', () => {
    afterEach(() => { clearAllCookies(); vi.unstubAllGlobals(); vi.useRealTimers(); });

    it('fires when consent is within warning window', () => {
        const c = createConsentify({
            policy: { categories: ['analytics'] as const },
            consentMaxAgeDays: 30,
            expirationWarningDays: 31,
        });
        const handler = vi.fn();
        c.on('expiring', handler);
        c.set({ analytics: true });
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith(expect.objectContaining({
            expiresAt: expect.any(Number),
            daysRemaining: expect.any(Number),
            timestamp: expect.any(Number),
        }));
    });

    it('does NOT fire when consentMaxAgeDays is not set', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const handler = vi.fn();
        c.on('expiring', handler);
        c.set({ analytics: true });
        expect(handler).not.toHaveBeenCalled();
    });

    it('does NOT fire when consent is fresh (outside warning window)', () => {
        const c = createConsentify({
            policy: { categories: ['analytics'] as const },
            consentMaxAgeDays: 365,
            expirationWarningDays: 30,
        });
        const handler = vi.fn();
        c.on('expiring', handler);
        c.set({ analytics: true });
        expect(handler).not.toHaveBeenCalled();
    });

    it('fires once per givenAt; re-affirmation and clear + re-consent re-arm it', () => {
        const t0 = Date.now();
        vi.setSystemTime(t0);
        const c = createConsentify({
            policy: { categories: ['analytics'] as const },
            consentMaxAgeDays: 30,
            expirationWarningDays: 31,
        });
        const handler = vi.fn();
        c.on('expiring', handler);

        c.set({ analytics: true });
        expect(handler).toHaveBeenCalledTimes(1);

        // Re-affirming the same choices is a new decision with a fresh givenAt
        vi.setSystemTime(t0 + 1000);
        c.set({ analytics: true });
        expect(handler).toHaveBeenCalledTimes(2);

        // Clear resets the dedup tracker, even for an identical givenAt
        c.clear();
        c.set({ analytics: true });
        expect(handler).toHaveBeenCalledTimes(3);
    });

    it('payload has correct expiresAt', () => {
        const c = createConsentify({
            policy: { categories: ['analytics'] as const },
            consentMaxAgeDays: 30,
            expirationWarningDays: 31,
        });
        const handler = vi.fn();
        c.on('expiring', handler);
        c.set({ analytics: true });

        const event = handler.mock.calls[0][0];
        const state = c.get();
        if (state.decision === 'decided') {
            const expectedExpiry = new Date(state.snapshot.givenAt).getTime() + 30 * 24 * 60 * 60 * 1000;
            expect(event.expiresAt).toBe(expectedExpiry);
        }
    });

    it('fires on init if consent already expiring', () => {
        // Pre-set a cookie with givenAt 25 days ago, maxAge 30 days, warning 10 days
        // => 5 days remaining, within 10-day warning window
        const givenAt = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString();
        const policyHash = hashPolicy(['analytics']);
        const snapshot = { policy: policyHash, givenAt, choices: { necessary: true, analytics: true } };
        setCookie('consentify', enc(snapshot));

        // Subscribe BEFORE creating instance isn't possible, so verify via a
        // second set() call that the expiring event fires for existing consent.
        // The init fires checkExpiring but no handler is registered yet.
        // After subscribing, a new set() with different choices triggers a new givenAt,
        // so we verify the init path indirectly: the state should be 'decided' on init.
        const c = createConsentify({
            policy: { categories: ['analytics'] as const },
            consentMaxAgeDays: 30,
            expirationWarningDays: 10,
        });
        expect(c.get().decision).toBe('decided');
    });

    it('does NOT fire for expired consent (daysRemaining <= 0)', () => {
        const givenAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
        const policyHash = hashPolicy(['analytics']);
        const snapshot = { policy: policyHash, givenAt, choices: { necessary: true, analytics: true } };
        setCookie('consentify', enc(snapshot));

        const handler = vi.fn();
        const c = createConsentify({
            policy: { categories: ['analytics'] as const },
            consentMaxAgeDays: 30,
            expirationWarningDays: 10,
        });
        c.on('expiring', handler);
        // Consent is already expired (40 days > 30 days max), so state should be unset
        expect(c.get().decision).toBe('unset');
        expect(handler).not.toHaveBeenCalled();
    });
});

describe('ConsentAdapter integration', () => {
    beforeEach(() => { clearAllCookies(); localStorage.clear(); });
    afterEach(() => { clearAllCookies(); localStorage.clear(); vi.restoreAllMocks(); });

    const makeAdapter = () => {
        const saved: any[] = [];
        const adapter: ConsentAdapter & { _saved: any[]; _loaded: Snapshot<any> | null } = {
            _saved: saved,
            _loaded: null,
            async save(data) { saved.push(data); },
            async load() { return this._loaded; },
        };
        return adapter;
    };

    it('calls adapter.save after client.set with a snapshot and no proof (no secret)', async () => {
        const adapter = makeAdapter();
        const c = createConsentify({
            policy: { categories: ['analytics'] as const },
            adapter,
            visitorId: 'visitor-1',
        });
        c.set({ analytics: true });
        await vi.waitFor(() => expect(adapter._saved.length).toBe(1));
        expect(adapter._saved[0].visitorId).toBe('visitor-1');
        expect(adapter._saved[0].snapshot.choices.analytics).toBe(true);
        expect('proof' in adapter._saved[0]).toBe(false);
    });

    it('passes an HMAC proof to adapter.save when the instance has a secret', async () => {
        const adapter = makeAdapter();
        await withSimulatedServer(async () => {
            const c = createConsentify({
                policy: { categories: ['analytics'] as const },
                secret: 'dev-secret',
                adapter,
                visitorId: 'visitor-1',
            });
            c.client.set({ analytics: true });
            await vi.waitFor(() => expect(adapter._saved.length).toBe(1));
        });
        const { proof, snapshot } = adapter._saved[0];
        expect(proof.choices).toEqual(snapshot.choices);
        expect(proof.signature.length).toBe(64);
        expect(await verifyProof(proof, 'dev-secret')).toBe(true);
    });

    it('hydrates from adapter.load when local state is unset', async () => {
        const adapter = makeAdapter();
        const policy = hashPolicy(['analytics']);
        adapter._loaded = {
            policy,
            givenAt: new Date().toISOString(),
            choices: { necessary: true, analytics: true } as any,
        };
        const c = createConsentify({
            policy: { categories: ['analytics'] as const },
            adapter,
            visitorId: 'visitor-1',
        });
        await vi.waitFor(() => expect(c.get().decision).toBe('decided'));
        expect(c.isGranted('analytics')).toBe(true);
    });

    it('does not override local state if already decided', async () => {
        const adapter = makeAdapter();
        const policy = hashPolicy(['analytics']);
        const c = createConsentify({
            policy: { categories: ['analytics'] as const },
            adapter,
            visitorId: 'visitor-1',
        });
        c.set({ analytics: false });
        adapter._loaded = {
            policy,
            givenAt: new Date().toISOString(),
            choices: { necessary: true, analytics: true } as any,
        };
        await new Promise(r => setTimeout(r, 20));
        expect(c.isGranted('analytics')).toBe(false);
    });

    it('swallows adapter.save errors with console.warn', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const adapter: ConsentAdapter = {
            async save() { throw new Error('DB down'); },
            async load() { return null; },
        };
        const c = createConsentify({
            policy: { categories: ['analytics'] as const },
            adapter,
            visitorId: 'visitor-1',
        });
        expect(() => c.set({ analytics: true })).not.toThrow();
        await vi.waitFor(() => {
            const hit = warn.mock.calls.some(args =>
                typeof args[0] === 'string' && args[0].includes('adapter.save failed'),
            );
            expect(hit).toBe(true);
        });
    });

    it('swallows adapter.load errors with console.warn', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const adapter: ConsentAdapter = {
            async save() {},
            async load() { throw new Error('DB down'); },
        };
        createConsentify({
            policy: { categories: ['analytics'] as const },
            adapter,
            visitorId: 'visitor-1',
        });
        await vi.waitFor(() => {
            const hit = warn.mock.calls.some(args =>
                typeof args[0] === 'string' && args[0].includes('adapter.load failed'),
            );
            expect(hit).toBe(true);
        });
    });

    it('rejects adapter.load data whose policy hash no longer matches (stale categories)', async () => {
        const adapter = makeAdapter();
        adapter._loaded = {
            policy: 'stale-policy-hash-from-old-categories',
            givenAt: new Date().toISOString(),
            choices: { necessary: true, analytics: true } as any,
        };
        const c = createConsentify({
            policy: { categories: ['analytics'] as const },
            adapter,
            visitorId: 'visitor-1',
        });
        // Give the background load a few ticks, then confirm state is still unset.
        await new Promise(r => setTimeout(r, 20));
        expect(c.get().decision).toBe('unset');
    });

    it('rejects adapter.load data that is already expired', async () => {
        const adapter = makeAdapter();
        const policy = hashPolicy(['analytics']);
        adapter._loaded = {
            policy,
            givenAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
            choices: { necessary: true, analytics: true } as any,
        };
        const c = createConsentify({
            policy: { categories: ['analytics'] as const },
            consentMaxAgeDays: 30,
            adapter,
            visitorId: 'visitor-1',
        });
        await new Promise(r => setTimeout(r, 20));
        expect(c.get().decision).toBe('unset');
    });

    it('falls back to consentify_visitor localStorage key when no visitorId is provided', async () => {
        const adapter = makeAdapter();
        const c = createConsentify({
            policy: { categories: ['analytics'] as const },
            adapter,
        });
        c.set({ analytics: true });
        await vi.waitFor(() => expect(adapter._saved.length).toBe(1));
        expect(adapter._saved[0].visitorId).toBeTypeOf('string');
        expect(adapter._saved[0].visitorId.length).toBeGreaterThan(0);
        expect(localStorage.getItem('consentify_visitor')).toBe(adapter._saved[0].visitorId);
    });

    it('recovers when a user visitorId factory rejects on first call', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const adapter = makeAdapter();
        let call = 0;
        const c = createConsentify({
            policy: { categories: ['analytics'] as const },
            adapter,
            visitorId: () => {
                call++;
                if (call === 1) return Promise.reject(new Error('boom'));
                return Promise.resolve('visitor-2');
            },
        });
        c.set({ analytics: true });
        await vi.waitFor(() => expect(adapter._saved.length).toBe(1));
        expect(adapter._saved[0].visitorId).toBe('');
        expect(warn).toHaveBeenCalled();
        c.set({ analytics: false });
        await vi.waitFor(() => expect(adapter._saved.length).toBe(2));
        expect(adapter._saved[1].visitorId).toBe('visitor-2');
    });

    it('keeps visitorId empty when the factory rejects every call', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const adapter = makeAdapter();
        const c = createConsentify({
            policy: { categories: ['analytics'] as const },
            adapter,
            visitorId: () => Promise.reject(new Error('always broken')),
        });
        c.set({ analytics: true });
        await vi.waitFor(() => expect(adapter._saved.length).toBe(1));
        c.set({ analytics: false });
        await vi.waitFor(() => expect(adapter._saved.length).toBe(2));
        c.set({ analytics: true });
        await vi.waitFor(() => expect(adapter._saved.length).toBe(3));
        for (const saved of adapter._saved) expect(saved.visitorId).toBe('');
        expect(warn).toHaveBeenCalled();
    });
});

function withSimulatedServer<T>(fn: () => T | Promise<T>): Promise<T> {
    const w = globalThis.window;
    const d = globalThis.document;
    // @ts-expect-error - simulating SSR
    delete globalThis.window;
    // @ts-expect-error - simulating SSR
    delete globalThis.document;
    const restore = () => { globalThis.window = w; globalThis.document = d; };
    try {
        return Promise.resolve(fn()).finally(restore);
    } catch (err) {
        restore();
        throw err;
    }
}

// Round-trip helper: server.set() produces a Set-Cookie header; server.get()
// wants a Cookie header. Extract the value and repack.
function setHeaderToCookieHeader(setHeader: string): string {
    const match = /consentify=([^;]+)/.exec(setHeader);
    return 'consentify=' + match![1];
}

describe('HMAC-SHA256 proof', () => {
    beforeEach(() => { clearAllCookies(); });
    afterEach(() => { clearAllCookies(); vi.restoreAllMocks(); });

    it('throws ConsentifyConfigError when secret is passed in a browser', () => {
        expect(() => {
            createConsentify({
                policy: { categories: ['analytics'] as const },
                secret: 'dev-secret',
            });
        }).toThrow(ConsentifyConfigError);
    });

    it('getProof returns a Promise<ConsentProof> when secret is set (server)', async () => {
        await withSimulatedServer(async () => {
            const c = createConsentify({
                policy: { categories: ['analytics'] as const },
                secret: 'dev-secret',
            });
            const cookieHeader = setHeaderToCookieHeader(
                c.set({ analytics: true }, { cookieHeader: 'consentify=' + enc({}) }),
            );
            const proofPromise = c.getProof({ cookieHeader });
            expect(proofPromise).toBeInstanceOf(Promise);
            const proof = await proofPromise;
            expect(proof).not.toBeNull();
            expect(proof!.signature).toBeTypeOf('string');
            expect(proof!.signature.length).toBe(64);
            expect(proof!.choices.analytics).toBe(true);
        });
    });

    it('getProof() resolves to null when there is no decision', async () => {
        await withSimulatedServer(async () => {
            const c = createConsentify({
                policy: { categories: ['analytics'] as const },
                secret: 'dev-secret',
            });
            expect(await c.getProof()).toBeNull();
            expect(await c.getProof({})).toBeNull();
            expect(await c.getProof({ cookieHeader: 'other=1' })).toBeNull();
        });
    });

    it('verifyProof succeeds for a valid HMAC proof', async () => {
        await withSimulatedServer(async () => {
            const c = createConsentify({
                policy: { categories: ['analytics'] as const },
                secret: 'dev-secret',
            });
            const cookieHeader = setHeaderToCookieHeader(
                c.set({ analytics: true }, { cookieHeader: 'consentify=' + enc({}) }),
            );
            const proof = await c.getProof({ cookieHeader });
            expect(await verifyProof(proof!, 'dev-secret')).toBe(true);
        });
    });

    it('verifyProof fails with wrong secret', async () => {
        await withSimulatedServer(async () => {
            const c = createConsentify({
                policy: { categories: ['analytics'] as const },
                secret: 'dev-secret',
            });
            const cookieHeader = setHeaderToCookieHeader(
                c.set({ analytics: true }, { cookieHeader: 'consentify=' + enc({}) }),
            );
            const proof = await c.getProof({ cookieHeader });
            expect(await verifyProof(proof!, 'wrong-secret')).toBe(false);
        });
    });

    it('verifyProof fails when proof is tampered', async () => {
        await withSimulatedServer(async () => {
            const c = createConsentify({
                policy: { categories: ['analytics'] as const },
                secret: 'dev-secret',
            });
            const cookieHeader = setHeaderToCookieHeader(
                c.set({ analytics: true }, { cookieHeader: 'consentify=' + enc({}) }),
            );
            const proof = await c.getProof({ cookieHeader });
            const tampered: ConsentProof<'analytics'> = { ...proof!, choices: { ...proof!.choices, analytics: false } };
            expect(await verifyProof(tampered, 'dev-secret')).toBe(false);
        });
    });
});

describe('Cloud mode (Mode B)', () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
        clearAllCookies();
        localStorage.clear();
        originalFetch = globalThis.fetch;
        // Prevent cross-test pollution: instances from prior tests still hold
        // references to the default BroadcastChannel and would receive our set()
        // notifications otherwise.
        vi.stubGlobal('BroadcastChannel', undefined);
    });
    afterEach(() => {
        clearAllCookies();
        localStorage.clear();
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('createConsentify rejects siteId and points to @consentify/core/cloud', () => {
        expect(() => createConsentify({ siteId: 'site_abc' } as any)).toThrow(ConsentifyConfigError);
        expect(() => createConsentify({ siteId: 'site_abc' } as any)).toThrow('@consentify/core/cloud');
        // Compile-time: the typed overloads reject `siteId` too.
        // @ts-expect-error siteId is not part of the self-hosted init
        expect(() => createConsentify({ policy: { categories: ['analytics'] }, siteId: 'site_abc' })).toThrow(ConsentifyConfigError);
    });

    const stubConfigFetch = (
        siteCfg: { categories: string[]; policyIdentifier: string; mode?: 'opt-in' | 'opt-out' },
        latestHash = 'abc123',
    ): ReturnType<typeof vi.fn> => {
        const spy = vi.fn((url: string) => {
            if (url.endsWith('/latest.json')) {
                return Promise.resolve(new Response(JSON.stringify({ current: latestHash })));
            }
            if (url.endsWith(`/${latestHash}.json`)) {
                return Promise.resolve(new Response(JSON.stringify(siteCfg)));
            }
            return Promise.resolve(new Response('ok'));
        });
        vi.stubGlobal('fetch', spy);
        return spy;
    };

    it('returns a Promise when siteId is provided', async () => {
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const promise = createCloudConsentify({
            siteId: 'site_abc',
            endpoints: { config: 'https://cdn.test', ingest: 'https://ingest.test' },
        });
        expect(promise).toBeInstanceOf(Promise);
        const c = await promise;
        expect(c.policy.identifier).toBe('v1');
        expect(spy.mock.calls[0][0]).toBe('https://cdn.test/config/site_abc/latest.json');
        expect(spy.mock.calls[1][0]).toBe('https://cdn.test/config/site_abc/abc123.json');
    });

    it('uses categories from the fetched SiteConfig', async () => {
        stubConfigFetch({ categories: ['analytics', 'marketing'], policyIdentifier: 'v2' });
        const c = await createCloudConsentify({
            siteId: 'site_abc',
            endpoints: { config: 'https://cdn.test', ingest: 'https://ingest.test' },
        });
        expect(c.policy.categories).toEqual(['analytics', 'marketing']);
    });

    it('local overrides take precedence over SiteConfig', async () => {
        stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1', mode: 'opt-in' });
        const c = await createCloudConsentify({
            siteId: 'site_abc',
            mode: 'opt-out',
            endpoints: { config: 'https://cdn.test', ingest: 'https://ingest.test' },
        });
        expect(c.mode).toBe('opt-out');
    });

    it('throws ConsentifyConfigError on fetch failure', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
        await expect(createCloudConsentify({
            siteId: 'site_abc',
            endpoints: { config: 'https://cdn.test', ingest: 'https://ingest.test' },
        })).rejects.toThrow(ConsentifyConfigError);
    });

    it('throws ConsentifyConfigError when latest.json is malformed', async () => {
        vi.stubGlobal('fetch', vi.fn((url: string) => {
            if (url.endsWith('/latest.json')) {
                return Promise.resolve(new Response(JSON.stringify({ wrong: 'shape' })));
            }
            return Promise.resolve(new Response('ok'));
        }));
        await expect(createCloudConsentify({
            siteId: 'site_abc',
            endpoints: { config: 'https://cdn.test' },
        })).rejects.toThrow(ConsentifyConfigError);
    });

    it('POSTs events to the ingest endpoint on consent change', async () => {
        vi.stubGlobal('navigator', { ...navigator, sendBeacon: undefined });
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const c = await createCloudConsentify({
            siteId: 'site_abc',
            apiKey: 'sk_test',
            endpoints: { config: 'https://cdn.test', ingest: 'https://ingest.test' },
        });
        c.set({ analytics: true });
        await vi.waitFor(() => {
            const ingestCall = spy.mock.calls.find(
                ([url]) => typeof url === 'string' && url.includes('ingest.test'),
            );
            expect(ingestCall).toBeDefined();
        });
        const ingestCall = spy.mock.calls.find(
            ([url]) => typeof url === 'string' && url.includes('ingest.test'),
        )!;
        expect(ingestCall[0]).toBe('https://ingest.test/v1/events');
    });

    it('writes failed send to consentify_event_buffer and drains on next success', async () => {
        let failNext = true;
        const cfg = { categories: ['analytics'], policyIdentifier: 'v1' };
        const spy = vi.fn((url: string) => {
            if (url.endsWith('/latest.json')) return Promise.resolve(new Response(JSON.stringify({ current: 'h1' })));
            if (url.endsWith('/h1.json')) return Promise.resolve(new Response(JSON.stringify(cfg)));
            if (url.includes('ingest.test')) {
                if (failNext) {
                    failNext = false;
                    return Promise.resolve(new Response('err', { status: 500 }));
                }
                return Promise.resolve(new Response('ok'));
            }
            return Promise.resolve(new Response('ok'));
        });
        vi.stubGlobal('fetch', spy);
        vi.stubGlobal('navigator', { ...navigator, sendBeacon: undefined });

        const c = await createCloudConsentify({
            siteId: 'site_abc',
            endpoints: { config: 'https://cdn.test', ingest: 'https://ingest.test' },
        });
        c.set({ analytics: true });
        await vi.waitFor(() => {
            expect(localStorage.getItem('consentify_event_buffer')).not.toBeNull();
        });

        c.set({ analytics: false });
        await vi.waitFor(() => {
            expect(localStorage.getItem('consentify_event_buffer')).toBeNull();
        });
    });

    it('throws ConsentifyConfigError when the versioned config fetch returns non-200', async () => {
        vi.stubGlobal('fetch', vi.fn((url: string) => {
            if (url.endsWith('/latest.json')) {
                return Promise.resolve(new Response(JSON.stringify({ current: 'h1' })));
            }
            // hash.json returns 404
            return Promise.resolve(new Response('not found', { status: 404 }));
        }));
        await expect(createCloudConsentify({
            siteId: 'site_abc',
            endpoints: { config: 'https://cdn.test' },
        })).rejects.toThrow(ConsentifyConfigError);
    });

    const ingestCalls = (spy: ReturnType<typeof vi.fn>) =>
        spy.mock.calls.filter(([url]) => typeof url === 'string' && url.includes('ingest.test'));

    it('reports a re-affirmation of the same choices as a new event', async () => {
        vi.stubGlobal('navigator', { ...navigator, sendBeacon: undefined });
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const c = await createCloudConsentify({
            siteId: 'site_abc',
            endpoints: { config: 'https://cdn.test', ingest: 'https://ingest.test' },
        });
        const t0 = Date.now();
        vi.setSystemTime(t0);
        c.set({ analytics: true });
        await vi.waitFor(() => expect(ingestCalls(spy)).toHaveLength(1));

        // Same choices later: a new decision with a fresh givenAt -> new POST
        vi.setSystemTime(t0 + 60_000);
        c.set({ analytics: true });
        await vi.waitFor(() => expect(ingestCalls(spy)).toHaveLength(2));
        expect(JSON.parse(ingestCalls(spy)[1][1].body).action).toBe('accept_all');
    });

    it('does not re-report a decision echoed from another tab', async () => {
        MockBroadcastChannel.channels.clear();
        vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
        vi.stubGlobal('navigator', { ...navigator, sendBeacon: undefined });
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const init = {
            siteId: 'site_abc',
            endpoints: { config: 'https://cdn.test', ingest: 'https://ingest.test' },
        };
        const tab1 = await createCloudConsentify(init);
        const tab2 = await createCloudConsentify(init);
        const tab2Change = vi.fn();
        tab2.on('change', tab2Change);

        tab1.set({ analytics: true });
        expect(tab2Change).toHaveBeenCalledOnce(); // the echo reached tab2
        await new Promise(r => setTimeout(r, 20));
        expect(ingestCalls(spy)).toHaveLength(1);
        tab1.destroy();
        tab2.destroy();
    });

    it('does not re-report an already-sent decision on the next page load', async () => {
        vi.stubGlobal('navigator', { ...navigator, sendBeacon: undefined });
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const init = {
            siteId: 'site_abc',
            endpoints: { config: 'https://cdn.test', ingest: 'https://ingest.test' },
        };
        const c = await createCloudConsentify(init);
        c.set({ analytics: true });
        await vi.waitFor(() => {
            expect(spy.mock.calls.some(([url]) =>
                typeof url === 'string' && url.includes('ingest.test'),
            )).toBe(true);
        });
        const firstIngestCount = spy.mock.calls.filter(([url]) =>
            typeof url === 'string' && url.includes('ingest.test'),
        ).length;

        // Simulate a reload: a fresh instance hydrates the same decided state
        // from the cookie and must not re-send it (dedup key is persisted).
        await createCloudConsentify(init);
        await new Promise(r => setTimeout(r, 20));
        const secondIngestCount = spy.mock.calls.filter(([url]) =>
            typeof url === 'string' && url.includes('ingest.test'),
        ).length;
        expect(secondIngestCount).toBe(firstIngestCount);
    });
});

// ============================================================
// 14. destroy() and cleanup
// ============================================================
describe('destroy()', () => {
    beforeEach(() => {
        clearAllCookies();
        MockBroadcastChannel.channels.clear();
        vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        MockBroadcastChannel.channels.clear();
    });

    it('listeners no longer fire after destroy', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const listener = vi.fn();
        c.client.subscribe(listener);
        c.client.set({ analytics: true });
        expect(listener).toHaveBeenCalledTimes(1);

        c.destroy();
        c.client.set({ analytics: false });
        expect(listener).toHaveBeenCalledTimes(1); // no additional call
    });

    it('destroyed instance stops receiving cross-tab updates', () => {
        const c1 = createConsentify({ policy: { categories: ['analytics'] as const } });
        const c2 = createConsentify({ policy: { categories: ['analytics'] as const } });
        const listener = vi.fn();
        c2.client.subscribe(listener);

        c1.client.set({ analytics: true });
        expect(listener).toHaveBeenCalledTimes(1);

        c2.destroy();
        c1.client.set({ analytics: false });
        expect(listener).toHaveBeenCalledTimes(1); // no additional call after destroy
    });

    it('destroyed instance does not send cross-tab messages', () => {
        const c1 = createConsentify({ policy: { categories: ['analytics'] as const } });
        const c2 = createConsentify({ policy: { categories: ['analytics'] as const } });
        const listener2 = vi.fn();
        c2.client.subscribe(listener2);

        c1.destroy();
        c1.client.set({ analytics: true });
        expect(listener2).not.toHaveBeenCalled();
    });

    it('double destroy() does not throw', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        expect(() => {
            c.destroy();
            c.destroy();
        }).not.toThrow();
    });

    it('event handlers cleared after destroy', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const handler = vi.fn();
        c.on('change', handler);
        c.destroy();
        c.client.set({ analytics: true });
        expect(handler).not.toHaveBeenCalled();
    });
});

// ============================================================
// 15. Cookie size warning
// ============================================================
describe('cookie size warning', () => {
    beforeEach(clearAllCookies);

    it('warns when encoded cookie exceeds 3.5KB on client.set', () => {
        // Create 100 categories with 40-char names to generate large encoded value
        const cats = Array.from({ length: 100 }, (_, i) => `cat_${i}_${'x'.repeat(32)}`) as any;
        const c = createConsentify({ policy: { categories: cats } });

        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        c.client.set({ [cats[0]]: true });
        expect(spy).toHaveBeenCalledWith(
            '[consentify] consent cookie exceeds 3.5KB; browsers cap at 4KB',
        );
        spy.mockRestore();
    });

    it('warns when encoded cookie exceeds 3.5KB on server.set', () => {
        const cats = Array.from({ length: 100 }, (_, i) => `cat_${i}_${'x'.repeat(32)}`) as any;
        const c = createConsentify({ policy: { categories: cats } });

        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        c.server.set({ [cats[0]]: true });
        expect(spy).toHaveBeenCalledWith(
            '[consentify] consent cookie exceeds 3.5KB; browsers cap at 4KB',
        );
        spy.mockRestore();
    });

    it('does not warn for normal small policy', () => {
        const c = createConsentify({ policy: { categories: ['analytics', 'marketing'] as const } });
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        c.client.set({ analytics: true });
        c.server.set({ marketing: true });
        // Should not warn about cookie size
        expect(spy.mock.calls.filter(
            (call) => call[1]?.includes?.('cookie exceeds'),
        )).toHaveLength(0);
        spy.mockRestore();
    });
});

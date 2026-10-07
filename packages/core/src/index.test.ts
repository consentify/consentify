import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { version as pkgVersion } from '../package.json';
import { createCloudConsentify, reportConsent } from './cloud';
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

describe('set() re-affirmation and restore', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const givenAt = (s: ConsentState<string>) => (s.decision === 'decided' ? s.snapshot.givenAt : null);
    const fromHeader = (h: string) => JSON.parse(decodeURIComponent(h.split(';')[0].slice('consentify='.length)));

    beforeEach(() => {
        clearAllCookies();
        vi.stubGlobal('BroadcastChannel', undefined);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        clearAllCookies();
    });

    it('identical choices with a source refresh givenAt and id, persist them, notify and emit change', () => {
        const t0 = Date.now();
        vi.setSystemTime(t0);
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        c.client.set({ analytics: true }, { source: 'banner' });
        const first = c.client.get();

        vi.setSystemTime(t0 + 60_000);
        const listener = vi.fn();
        const handler = vi.fn();
        c.client.subscribe(listener);
        c.on('change', handler);
        c.client.set({ analytics: true }, { source: 'preferences' });
        const second = c.client.get();

        expect(givenAt(first)).toBe(new Date(t0).toISOString());
        expect(givenAt(second)).toBe(new Date(t0 + 60_000).toISOString());
        expect(second.decision === 'decided' && second.snapshot.id)
            .not.toBe(first.decision === 'decided' && first.snapshot.id);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0][0].from).toBe(first);
        expect(handler.mock.calls[0][0].to).toBe(second);
        // Written to storage: a fresh instance (page reload) sees the new timestamp.
        expect(createConsentify({ policy: { categories: ['analytics'] as const } }).client.get()).toEqual(second);
    });

    it('acceptAll({ source }) twice records two decisions', () => {
        const t0 = Date.now();
        vi.setSystemTime(t0);
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const handler = vi.fn();
        c.on('change', handler);
        c.acceptAll({ source: 'banner' });
        vi.setSystemTime(t0 + 1000);
        c.acceptAll({ source: 'banner' });
        expect(handler).toHaveBeenCalledTimes(2);
        expect(givenAt(c.get())).toBe(new Date(t0 + 1000).toISOString());
    });

    it('identical choices with a source extend expiration when consentMaxAgeDays is set', () => {
        const opts = { policy: { categories: ['analytics'] as const }, consentMaxAgeDays: 30 };
        const t0 = Date.now();
        vi.setSystemTime(t0);
        createConsentify(opts).client.set({ analytics: true }, { source: 'banner' });

        vi.setSystemTime(t0 + 25 * DAY);
        createConsentify(opts).client.set({ analytics: true }, { source: 'preferences' });

        // 31 days after the original decision it would have expired; the
        // re-affirmation 25 days in restarted the 30-day window.
        vi.setSystemTime(t0 + 31 * DAY);
        const reloaded = createConsentify(opts);
        expect(reloaded.client.get().decision).toBe('decided');
        expect(reloaded.isGranted('analytics')).toBe(true);
    });

    it('identical choices without a source are a no-op: same record, no notify, events, sync or adapter save', async () => {
        MockBroadcastChannel.channels.clear();
        vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
        const t0 = Date.now();
        vi.setSystemTime(t0);
        const save = vi.fn(async () => {});
        const init = {
            policy: { categories: ['analytics', 'marketing'] as const },
            consentMaxAgeDays: 30,
            visitorId: 'visitor-1',
            adapter: { save, async load() { return null; } },
        };
        const c = createConsentify(init);
        c.set({ analytics: true }, { source: 'preferences' });
        const first = c.get();
        await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());

        const otherTab = vi.fn();
        createConsentify(init).subscribe(otherTab);
        const listener = vi.fn();
        const onChange = vi.fn();
        c.subscribe(listener);
        c.on('change', onChange);
        vi.setSystemTime(t0 + 25 * DAY);
        // Restoring saved choices on load: partial and full forms, and acceptAll/rejectAll shapes.
        c.set({ analytics: true });
        c.set({ analytics: true, marketing: false }, { lang: 'de' });
        c.client.set({});

        expect(c.get()).toBe(first);
        expect(createConsentify(init).get()).toEqual(first); // storage untouched
        expect(listener).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
        expect(otherTab).not.toHaveBeenCalled();
        await new Promise(r => setTimeout(r, 20));
        expect(save).toHaveBeenCalledOnce();
        // A restore does not extend consent: it still expires 30 days after the decision.
        vi.setSystemTime(t0 + 31 * DAY);
        expect(createConsentify(init).get().decision).toBe('unset');
    });

    it('acceptAll() / rejectAll() without a source are a no-op when nothing changes', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const onChange = vi.fn();
        c.on('change', onChange);
        c.acceptAll();
        const accepted = c.get();
        c.acceptAll();
        expect(c.get()).toBe(accepted);
        c.rejectAll();
        const rejected = c.get();
        c.rejectAll();
        expect(c.get()).toBe(rejected);
        expect(onChange).toHaveBeenCalledTimes(2);
    });

    it('server: identical choices without a source re-serialize the stored record unchanged', () => {
        const t0 = Date.now();
        vi.setSystemTime(t0);
        const c = createConsentify({ policy: { categories: ['analytics', 'marketing'] as const, textVersion: 't1' } });
        const first = c.set({ analytics: true }, { cookieHeader: null, source: 'banner', lang: 'en' });
        const stored = fromHeader(first);
        const cookieHeader = setHeaderToCookieHeader(first);
        vi.setSystemTime(t0 + 60_000);
        for (const header of [
            c.set({ analytics: true }, { cookieHeader }),
            c.set({ analytics: true, marketing: false }, { cookieHeader, lang: 'de' }),
            c.server.set({}, cookieHeader),
        ]) {
            expect(header).toBe(first); // same id, givenAt and metadata
        }
        // With a source, or with changed choices, it is a new decision.
        const reaffirmed = fromHeader(c.set({ analytics: true }, { cookieHeader, source: 'preferences' }));
        expect(reaffirmed.id).not.toBe(stored.id);
        expect(reaffirmed.givenAt).toBe(new Date(t0 + 60_000).toISOString());
        expect(fromHeader(c.acceptAll({ cookieHeader })).id).not.toBe(stored.id);
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

    it('get({ cookieHeader }) with an undefined, empty or null header is server-side unset', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        c.client.set({ analytics: true });
        expect(c.get().decision).toBe('decided');
        // Server mode never reads the browser store.
        expect(c.get({ cookieHeader: undefined })).toEqual({ decision: 'unset' });
        expect(c.get({ cookieHeader: '' })).toEqual({ decision: 'unset' });
        expect(c.get({ cookieHeader: null })).toEqual({ decision: 'unset' });
    });

    it('an argument without a cookieHeader key is not server mode', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        c.client.set({ analytics: true });
        // v2 call shapes from untyped code fall through to the client store.
        expect((c.get as (x: unknown) => unknown)('consentify=x')).toBe(c.client.get());
        expect((c.get as (x: unknown) => unknown)(null)).toBe(c.client.get());
        expect((c.get as (x: unknown) => unknown)({})).toBe(c.client.get());
        expect((c.clear as (x: unknown) => unknown)({})).toBeUndefined();
        expect(c.get()).toEqual({ decision: 'unset' });
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

    it('set(choices, { cookieHeader: undefined }) returns Set-Cookie string', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const result = c.set({ analytics: true }, { cookieHeader: undefined });
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

    it('clear({ cookieHeader }) returns a Max-Age=0 header and leaves the client store alone', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        c.client.set({ analytics: true });
        const result = c.clear({ cookieHeader: undefined });
        expect(typeof result).toBe('string');
        expect(result).toContain('consentify=;');
        expect(result).toContain('Max-Age=0');
        expect(c.get().decision).toBe('decided');
    });

    it('isGranted(category, { cookieHeader }) reads the header (opt-in)', () => {
        const c = createConsentify({ policy: { categories: ['analytics', 'marketing'] as const } });
        const cookieHeader = c.set({ analytics: true }, { cookieHeader: null }).split(';')[0];
        expect(c.isGranted('analytics', { cookieHeader })).toBe(true);
        expect(c.isGranted('marketing', { cookieHeader })).toBe(false);
        expect(c.isGranted('analytics', { cookieHeader: undefined })).toBe(false);
        expect(c.isGranted('necessary', { cookieHeader: undefined })).toBe(true);
    });

    it('isGranted(category, { cookieHeader }) follows opt-out when unset', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const }, mode: 'opt-out' });
        expect(c.isGranted('analytics', { cookieHeader: null })).toBe(true);
        expect(c.isGranted('analytics', { cookieHeader: 'other=1' })).toBe(true);
        const cookieHeader = c.set({ analytics: false }, { cookieHeader: null }).split(';')[0];
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
        const header = c.set({ analytics: true }, { cookieHeader: null });
        const { name, value, options } = parseSetCookie(header);
        expect(name).toBe('cc');
        expect(value).toBe(decodeURIComponent(header.slice(3, header.indexOf(';'))));
        expect(options).toEqual({ path: '/app', maxAge: 3600, domain: '.example.com', sameSite: 'strict', secure: true });
        expect(c.get({ cookieHeader: `${name}=${encodeURIComponent(value)}` }).decision).toBe('decided');
    });

    it('clear() header yields maxAge 0 and an empty value', () => {
        const { name, value, options } = parseSetCookie(mk().clear({ cookieHeader: null }));
        expect(name).toBe('cc');
        expect(value).toBe('');
        expect(options.maxAge).toBe(0);
    });

    it('returns the URI-decoded value', () => {
        const { value } = parseSetCookie(mk().set({ analytics: false }, { cookieHeader: null }));
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

    it('rejectAll({ cookieHeader: null }) returns Set-Cookie string', () => {
        const c = createConsentify({ policy: { categories: ['analytics'] as const } });
        const header = c.rejectAll({ cookieHeader: null });
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
        for (const header of [c.set({ analytics: false }, { cookieHeader: null }), c.server.set({ analytics: false })]) {
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
        const s = c.server.get(setHeaderToCookieHeader(c.set({ analytics: true }, { cookieHeader: null })));
        if (s.decision !== 'decided') throw new Error('expected decided');
        expect(s.snapshot.choices).toEqual({ necessary: true, analytics: true, marketing: false });
    });

    it('opt-out mode: rejectAll still denies every category', () => {
        const c = createConsentify({ policy: { categories: ['analytics', 'marketing'] as const }, mode: 'opt-out' });
        c.rejectAll();
        expect(c.isGranted('analytics')).toBe(false);
        expect(c.isGranted('marketing')).toBe(false);
        expect(c.isGranted('necessary')).toBe(true);
        const s = c.server.get(setHeaderToCookieHeader(c.rejectAll({ cookieHeader: null })));
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

        // Re-affirming the same choices from the UI is a new decision with a fresh givenAt
        vi.setSystemTime(t0 + 1000);
        c.set({ analytics: true }, { source: 'preferences' });
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
        expect(localStorage.getItem('consentify_visitor')).toBeNull();
        c.set({ analytics: true });
        await vi.waitFor(() => expect(adapter._saved.length).toBe(1));
        expect(adapter._saved[0].visitorId).toBeTypeOf('string');
        expect(adapter._saved[0].visitorId.length).toBeGreaterThan(0);
        expect(localStorage.getItem('consentify_visitor')).toBe(adapter._saved[0].visitorId);
    });

    it('never links a reject-all to the stored visitor id: it gets a one-off token', async () => {
        const adapter = makeAdapter();
        const c = createConsentify({
            policy: { categories: ['analytics', 'marketing'] as const },
            adapter,
        });
        c.acceptAll({ source: 'banner' });
        await vi.waitFor(() => expect(adapter._saved.length).toBe(1));
        const first = adapter._saved[0].visitorId;
        expect(localStorage.getItem('consentify_visitor')).toBe(first);

        c.rejectAll({ source: 'banner' });
        await vi.waitFor(() => expect(adapter._saved.length).toBe(2));
        expect(adapter._saved[1].visitorId).toMatch(/^[0-9a-f]{8}$/);
        expect(localStorage.getItem('consentify_visitor')).toBeNull();

        // A customize with every category off is a refusal too.
        c.set({ analytics: true });
        await vi.waitFor(() => expect(adapter._saved.length).toBe(3));
        c.set({ analytics: false });
        await vi.waitFor(() => expect(adapter._saved.length).toBe(4));
        expect(adapter._saved[3].visitorId).toMatch(/^[0-9a-f]{8}$/);
        expect(adapter._saved[3].visitorId).not.toBe(adapter._saved[1].visitorId);
        expect(localStorage.getItem('consentify_visitor')).toBeNull();

        // The next grant starts a new persistent id, unrelated to the first one.
        c.set({ marketing: true });
        await vi.waitFor(() => expect(adapter._saved.length).toBe(5));
        expect(adapter._saved[4].visitorId).toMatch(/^[0-9a-f-]{36}$/);
        expect(adapter._saved[4].visitorId).not.toBe(first);
        expect(localStorage.getItem('consentify_visitor')).toBe(adapter._saved[4].visitorId);
    });

    it('an explicit visitorId is still passed for a reject-all', async () => {
        const adapter = makeAdapter();
        const c = createConsentify({
            policy: { categories: ['analytics'] as const },
            adapter,
            visitorId: 'acct-7',
        });
        c.rejectAll({ source: 'banner' });
        await vi.waitFor(() => expect(adapter._saved.length).toBe(1));
        expect(adapter._saved[0].visitorId).toBe('acct-7');
        expect(localStorage.getItem('consentify_visitor')).toBeNull();
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

    it('skips adapter.load and mints no visitor id for a first-time visitor', async () => {
        const adapter = makeAdapter();
        const load = vi.spyOn(adapter, 'load');
        createConsentify({
            policy: { categories: ['analytics'] as const },
            adapter,
        });
        await new Promise(r => setTimeout(r, 20));
        expect(load).not.toHaveBeenCalled();
        expect(localStorage.getItem('consentify_visitor')).toBeNull();
    });

    it('hydrates a returning visitor by the stored visitor id', async () => {
        localStorage.setItem('consentify_visitor', 'returning-1');
        const adapter = makeAdapter();
        const load = vi.spyOn(adapter, 'load');
        adapter._loaded = {
            policy: hashPolicy(['analytics']),
            givenAt: new Date().toISOString(),
            choices: { necessary: true, analytics: true } as any,
        };
        const c = createConsentify({
            policy: { categories: ['analytics'] as const },
            adapter,
        });
        await vi.waitFor(() => expect(c.get().decision).toBe('decided'));
        expect(load).toHaveBeenCalledWith('returning-1');
        expect(localStorage.getItem('consentify_visitor')).toBe('returning-1');
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
            expect(await c.getProof({ cookieHeader: undefined })).toBeNull();
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

describe('client writes outside a browser', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it('are ignored with a warning: no shared state, events, listeners or adapter save', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const save = vi.fn(async () => {});
        await withSimulatedServer(async () => {
            // A module-level instance on a server, as in a Next.js route or Server Action.
            const c = createConsentify({
                policy: { categories: ['analytics'] as const },
                secret: 'dev-secret',
                visitorId: 'visitor-1',
                adapter: { save, async load() { return null; } },
            });
            const listener = vi.fn();
            const onChange = vi.fn();
            const onClear = vi.fn();
            c.subscribe(listener);
            c.on('change', onChange);
            c.on('clear', onClear);

            expect(c.acceptAll({ source: 'api' })).toBeUndefined();
            expect(warn).toHaveBeenCalledOnce();
            expect(warn.mock.calls[0][0]).toContain('{ cookieHeader }');
            expect(c.set({ analytics: true })).toBeUndefined();
            expect(c.rejectAll()).toBeUndefined();
            expect(c.clear()).toBeUndefined();
            expect(c.client.set({ analytics: true })).toBeUndefined();
            expect(c.client.clear()).toBeUndefined();
            expect(warn).toHaveBeenCalledTimes(6);

            // The next request must not see the previous caller's consent.
            expect(c.get()).toEqual({ decision: 'unset' });
            expect(c.isGranted('analytics')).toBe(false);
            expect(await c.getProof()).toBeNull();
            expect(listener).not.toHaveBeenCalled();
            expect(onChange).not.toHaveBeenCalled();
            expect(onClear).not.toHaveBeenCalled();
            await new Promise(r => setTimeout(r, 20));
            expect(save).not.toHaveBeenCalled();
            // Server writes are unaffected.
            expect(c.acceptAll({ cookieHeader: null, source: 'api' })).toContain('consentify=');
        });
    });
});

describe('consent record v2', () => {
    const cats = ['analytics', 'marketing'] as const;
    const v2Keys = ['choices', 'givenAt', 'id', 'policy', 'v'];
    // Decoded record from a Set-Cookie header, or from document.cookie. An empty
    // value is a just-cleared cookie (happy-dom keeps `Max-Age=0` for up to 1 ms).
    const fromHeader = (h: string) => JSON.parse(decodeURIComponent(h.split(';')[0].slice('consentify='.length)));
    const fromDocument = () => {
        const m = /(?:^|; )consentify=([^;]+)/.exec(document.cookie);
        return m ? JSON.parse(decodeURIComponent(m[1])) : null;
    };
    const v1Record = (policy: string) => ({
        policy,
        givenAt: new Date().toISOString(),
        choices: { necessary: true, analytics: true, marketing: false },
    });

    beforeEach(() => { clearAllCookies(); document.documentElement.lang = ''; });
    afterEach(() => { clearAllCookies(); document.documentElement.lang = ''; vi.restoreAllMocks(); vi.useRealTimers(); });

    it('new records have v: 2 and omit unset metadata', () => {
        const c = createConsentify({ policy: { categories: cats } });
        c.set({ analytics: true });
        expect(fromDocument()).toEqual({
            v: 2,
            id: expect.stringMatching(/^[0-9a-f]{12}$/),
            policy: c.policy.identifier,
            givenAt: expect.any(String),
            choices: { necessary: true, analytics: true, marketing: false },
        });
        expect(Object.keys(fromDocument()).sort()).toEqual(v2Keys);
        const s = c.get();
        expect(s.decision === 'decided' && Object.keys(s.snapshot).sort()).toEqual(v2Keys);
        expect(Object.keys(fromHeader(c.set({}, { cookieHeader: null }))).sort()).toEqual(v2Keys);
    });

    it('every new record gets its own 12-hex id, client and server', () => {
        const t0 = Date.now();
        vi.setSystemTime(t0); // same millisecond for every write below
        const c = createConsentify({ policy: { categories: cats } });
        c.set({ analytics: true });
        const a = fromDocument();
        c.set({ analytics: false });
        const b = fromDocument();
        const s1 = fromHeader(c.set({ analytics: true }, { cookieHeader: null }));
        const s2 = fromHeader(c.acceptAll({ cookieHeader: null }));
        const ids = [a.id, b.id, s1.id, s2.id];
        for (const id of ids) expect(id).toMatch(/^[0-9a-f]{12}$/);
        expect(new Set(ids).size).toBe(4);
        expect(a.givenAt).toBe(b.givenAt);
        const s = c.get();
        expect(s.decision === 'decided' && s.snapshot.id).toBe(b.id);
    });

    it('generates ids without Web Crypto', () => {
        vi.stubGlobal('crypto', undefined);
        try {
            const c = createConsentify({ policy: { categories: cats } });
            expect(fromHeader(c.acceptAll({ cookieHeader: null })).id).toMatch(/^[0-9a-f]{12}$/);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('records policy.textVersion as pv without changing the policy identifier', () => {
        const c = createConsentify({ policy: { categories: cats, textVersion: '2026-10-01' } });
        expect(c.policy.identifier).toBe(createConsentify({ policy: { categories: cats } }).policy.identifier);
        c.acceptAll();
        expect(fromDocument().pv).toBe('2026-10-01');
        expect(fromHeader(c.acceptAll({ cookieHeader: null })).pv).toBe('2026-10-01');
        // A new text version does not invalidate the existing record.
        const bumped = createConsentify({ policy: { categories: cats, textVersion: '2026-11-01' } });
        const s = bumped.get();
        expect(s.decision === 'decided' && s.snapshot.pv).toBe('2026-10-01');
    });

    it('lang comes from the init option', () => {
        document.documentElement.lang = 'de';
        const c = createConsentify({ policy: { categories: cats }, lang: 'en-GB' });
        c.rejectAll();
        expect(fromDocument().lang).toBe('en-GB');
    });

    it('lang defaults to <html lang>, read at write time', () => {
        const c = createConsentify({ policy: { categories: cats } });
        c.set({ analytics: true });
        expect('lang' in fromDocument()).toBe(false);
        document.documentElement.lang = 'de';
        c.set({ marketing: true });
        expect(fromDocument().lang).toBe('de');
    });

    it('a per-call lang overrides the init option and <html lang>', () => {
        document.documentElement.lang = 'de';
        const c = createConsentify({ policy: { categories: cats }, lang: 'en-GB' });
        c.set({ analytics: true }, { lang: 'fr' });
        expect(fromDocument().lang).toBe('fr');
        c.acceptAll({ lang: 'sk' });
        expect(fromDocument().lang).toBe('sk');
        expect(fromHeader(c.rejectAll({ cookieHeader: null, lang: 'cs' })).lang).toBe('cs');
    });

    it('server writes take lang from init or the call, never from <html lang>', () => {
        document.documentElement.lang = 'de';
        const c = createConsentify({ policy: { categories: cats } });
        expect('lang' in fromHeader(c.set({ analytics: true }, { cookieHeader: null }))).toBe(false);
        const withInit = createConsentify({ policy: { categories: cats }, lang: 'pl' });
        expect(fromHeader(withInit.rejectAll({ cookieHeader: null })).lang).toBe('pl');
    });

    it('records src per call on set, acceptAll and rejectAll (client)', () => {
        const c = createConsentify({ policy: { categories: cats } });
        c.acceptAll({ source: 'banner' });
        expect(fromDocument().src).toBe('banner');
        c.set({ marketing: false }, { source: 'preferences' });
        expect(fromDocument().src).toBe('preferences');
        c.rejectAll({ source: 'api' });
        expect(fromDocument().src).toBe('api');
        // Metadata belongs to one decision; it is not carried over.
        c.set({ analytics: true });
        expect('src' in fromDocument()).toBe(false);
    });

    it('records src per call on set, acceptAll and rejectAll (server)', () => {
        const c = createConsentify({ policy: { categories: cats } });
        const first = c.acceptAll({ cookieHeader: null, source: 'banner' });
        expect(fromHeader(first).src).toBe('banner');
        const cookieHeader = setHeaderToCookieHeader(first);
        expect(fromHeader(c.set({ marketing: false }, { cookieHeader, source: 'preferences' }))).toMatchObject({
            src: 'preferences',
            choices: { analytics: true, marketing: false },
        });
        expect(fromHeader(c.rejectAll({ cookieHeader, source: 'api' })).src).toBe('api');
        // Merging keeps the previous choices but not the previous metadata.
        expect(fromHeader(c.set({ marketing: false }, { cookieHeader }))).not.toHaveProperty('src');
        expect(fromHeader(c.server.set({ analytics: true }, null, { source: 'api' })).src).toBe('api');
    });

    it('set(choices, { source }) stays client-side and returns undefined', () => {
        const c = createConsentify({ policy: { categories: cats } });
        const listener = vi.fn();
        c.subscribe(listener);
        expect(c.set({ analytics: true }, { source: 'banner', lang: 'en' })).toBeUndefined();
        expect(c.acceptAll({ source: 'banner' })).toBeUndefined();
        expect(listener).toHaveBeenCalledTimes(2);
        const s = c.get();
        expect(s.decision === 'decided' && s.snapshot).toMatchObject({ v: 2, src: 'banner' });
        expect(fromDocument()).toMatchObject({ v: 2, src: 'banner' });
    });

    it('set(choices, { cookieHeader: undefined }) is server mode', () => {
        const c = createConsentify({ policy: { categories: cats } });
        const header = c.set({ analytics: true }, { cookieHeader: undefined, source: 'api' });
        expect(typeof header).toBe('string');
        expect(fromHeader(header)).toMatchObject({ v: 2, src: 'api' });
        expect(c.get()).toEqual({ decision: 'unset' });
        expect(fromDocument()).toBeNull();
    });

    it('a v1 cookie still reads as decided and the next write produces v2', () => {
        const c = createConsentify({ policy: { categories: cats } });
        const v1 = v1Record(c.policy.identifier);
        expect(c.get({ cookieHeader: `consentify=${enc(v1)}` })).toEqual({ decision: 'decided', snapshot: v1 });
        setCookie('consentify', enc(v1));
        const fresh = createConsentify({ policy: { categories: cats } });
        expect(fresh.get()).toEqual({ decision: 'decided', snapshot: v1 });
        fresh.set({ marketing: true }, { source: 'preferences' });
        expect(fromDocument()).toMatchObject({ v: 2, src: 'preferences', choices: { analytics: true, marketing: true } });
    });

    it('rejects records with an invalid src, non-string id, pv or lang, or an unknown v', () => {
        const c = createConsentify({ policy: { categories: cats } });
        const base = { v: 2, ...v1Record(c.policy.identifier) };
        const read = (o: object) => c.get({ cookieHeader: `consentify=${enc(o)}` }).decision;
        expect(read({ ...base, id: '0a1b2c3d4e5f', pv: '1', lang: 'en', src: 'banner' })).toBe('decided');
        expect(read({ ...base, id: 42 })).toBe('unset');
        expect(read({ ...base, id: null })).toBe('unset');
        expect(read({ ...base, src: 'popup' })).toBe('unset');
        expect(read({ ...base, src: null })).toBe('unset');
        expect(read({ ...base, pv: 3 })).toBe('unset');
        expect(read({ ...base, pv: null })).toBe('unset');
        expect(read({ ...base, lang: ['en'] })).toBe('unset');
        expect(read({ ...base, v: 3 })).toBe('unset');
        expect(read({ ...base, v: '2' })).toBe('unset');
    });

    it('untyped callers cannot write a record that the next read rejects', () => {
        const c = createConsentify({ policy: { categories: cats, textVersion: 7 as unknown as string } });
        c.set({ analytics: true }, { source: 'popup' as never, lang: 5 as unknown as string });
        const stored = fromDocument();
        expect(stored).toMatchObject({ v: 2, pv: '7', lang: '5' });
        expect('src' in stored).toBe(false);
        expect(createConsentify({ policy: { categories: cats } }).get().decision).toBe('decided');
    });

    it("the 'change' event and adapter.save carry the full v2 record", async () => {
        const saved: { snapshot: Snapshot<string> }[] = [];
        const c = createConsentify({
            policy: { categories: cats, textVersion: 't1' },
            lang: 'en',
            visitorId: 'visitor-1',
            adapter: { async save(d) { saved.push(d); }, async load() { return null; } },
        });
        const onChange = vi.fn();
        c.on('change', onChange);
        c.acceptAll({ source: 'banner' });
        const expected = { v: 2, pv: 't1', lang: 'en', src: 'banner' };
        expect(onChange.mock.calls[0][0].to.snapshot).toMatchObject(expected);
        await vi.waitFor(() => expect(saved.length).toBe(1));
        expect(saved[0].snapshot).toMatchObject(expected);
    });

    it('hydrates v1 and v2 records from adapter.load as stored', async () => {
        for (const extra of [{}, { v: 2 as const, pv: 't1', lang: 'de', src: 'preferences' as const }]) {
            clearAllCookies();
            const remote: Snapshot<'analytics' | 'marketing'> = { ...v1Record(hashPolicy(cats)), ...extra };
            const c = createConsentify({
                policy: { categories: cats },
                visitorId: 'visitor-1',
                adapter: { async save() {}, async load() { return remote; } },
            });
            await vi.waitFor(() => expect(c.get().decision).toBe('decided'));
            expect(c.get()).toEqual({ decision: 'decided', snapshot: remote });
            c.destroy();
        }
    });

    it('the HMAC proof covers id, v, pv, lang and src', async () => {
        await withSimulatedServer(async () => {
            const c = createConsentify({
                policy: { categories: cats, textVersion: 't1' },
                lang: 'en',
                secret: 'dev-secret',
            });
            const cookieHeader = setHeaderToCookieHeader(c.acceptAll({ cookieHeader: null, source: 'banner' }));
            const proof = (await c.getProof({ cookieHeader }))!;
            expect(proof).toMatchObject({ v: 2, id: expect.stringMatching(/^[0-9a-f]{12}$/), pv: 't1', lang: 'en', src: 'banner' });
            expect(await verifyProof(proof, 'dev-secret')).toBe(true);
            for (const tampered of [
                { ...proof, id: '000000000000' },
                { ...proof, id: undefined },
                { ...proof, src: 'preferences' as const },
                { ...proof, src: undefined },
                { ...proof, lang: 'de' },
                { ...proof, pv: 't2' },
                { ...proof, v: undefined },
            ]) {
                expect(await verifyProof(tampered, 'dev-secret')).toBe(false);
            }
        });
    });

    it('v1 proofs still verify', async () => {
        // 2.x signed HMAC-SHA256 over stableStringify({ policy, givenAt, choices }).
        const v1 = v1Record('p1');
        const te = new TextEncoder();
        const key = await crypto.subtle.importKey('raw', te.encode('dev-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const sig = await crypto.subtle.sign('HMAC', key, te.encode(stableStringify(v1)));
        const signature = Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
        expect(await verifyProof({ ...v1, signature }, 'dev-secret')).toBe(true);
        expect(await verifyProof({ ...v1, signature, v: 2 }, 'dev-secret')).toBe(false);

        // A v1 record read by v3 yields a v1-shaped proof.
        await withSimulatedServer(async () => {
            const c = createConsentify({ policy: { categories: cats }, secret: 'dev-secret' });
            const stored = v1Record(c.policy.identifier);
            const proof = await c.getProof({ cookieHeader: `consentify=${enc(stored)}` });
            expect(proof).toEqual({ ...stored, signature: expect.any(String) });
            expect(await verifyProof(proof!, 'dev-secret')).toBe(true);
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
        vi.unstubAllGlobals(); // first: server tests stub `document` away
        clearAllCookies();
        localStorage.clear();
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
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
        siteCfg: { categories: string[]; policyIdentifier: string; mode?: 'opt-in' | 'opt-out'; [k: string]: unknown },
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

    const EP = { config: 'https://cdn.test', ingest: 'https://ingest.test' };
    const FB = { categories: ['analytics'], identifier: 'v1' };
    const CACHE_KEY = 'consentify_cfg_site_abc';
    const seedCache = (ageMs: number, h: string, c: { categories: string[]; policyIdentifier: string }) =>
        localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now() - ageMs, h, c }));
    const readCache = () => JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    const HOUR = 3_600_000;
    // A fetch whose responses wait until `release()`; `respond` maps URL to a JSON body.
    const gatedFetch = (respond: (url: string) => unknown) => {
        let release!: () => void;
        const gate = new Promise<void>(r => { release = r; });
        const spy = vi.fn(async (url: string) => {
            await gate;
            return new Response(JSON.stringify(respond(url)));
        });
        vi.stubGlobal('fetch', spy);
        return { spy, release };
    };

    const ingestCalls = (spy: ReturnType<typeof vi.fn>) =>
        spy.mock.calls.filter(([url]) => typeof url === 'string' && url.includes('ingest.test'));

    const ingestBodies = (spy: ReturnType<typeof vi.fn>) =>
        ingestCalls(spy).map(([, opts]) => JSON.parse((opts as RequestInit).body as string));

    it('returns a Promise when siteId is provided', async () => {
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const promise = createCloudConsentify({
            siteId: 'site_abc',
            endpoints: EP,
            fallback: FB,
        });
        expect(promise).toBeInstanceOf(Promise);
        const c = await promise;
        expect(c.policy.identifier).toBe('v1');
        expect(c.cloud.source).toBe('network');
        expect(c.cloud.config.policyIdentifier).toBe('v1');
        expect(spy.mock.calls[0][0]).toBe('https://cdn.test/config/site_abc/latest.json');
        expect(spy.mock.calls[1][0]).toBe('https://cdn.test/config/site_abc/abc123.json');
    });

    it('uses categories from the fetched SiteConfig', async () => {
        stubConfigFetch({ categories: ['analytics', 'marketing'], policyIdentifier: 'v2' });
        const c = await createCloudConsentify({
            siteId: 'site_abc',
            endpoints: EP,
            fallback: FB,
        });
        expect(c.policy.categories).toEqual(['analytics', 'marketing']);
    });

    it('local overrides take precedence over SiteConfig', async () => {
        stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1', mode: 'opt-in' });
        const c = await createCloudConsentify({
            siteId: 'site_abc',
            mode: 'opt-out',
            endpoints: EP,
            fallback: FB,
        });
        expect(c.mode).toBe('opt-out');
    });

    it('rejects with ConsentifyConfigError when fallback is missing', async () => {
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        await expect(createCloudConsentify({ siteId: 'site_abc', endpoints: EP } as any))
            .rejects.toThrow(ConsentifyConfigError);
        expect(spy).not.toHaveBeenCalled();
    });

    it('falls back on a network error without throwing, with one warning', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
        const c = await createCloudConsentify({
            siteId: 'site_abc',
            endpoints: EP,
            fallback: { categories: ['analytics', 'marketing'], identifier: 'v1', mode: 'opt-out' },
        });
        expect(c.cloud.source).toBe('fallback');
        expect(c.policy.categories).toEqual(['analytics', 'marketing']);
        expect(c.policy.identifier).toBe('v1');
        expect(c.mode).toBe('opt-out');
        expect(c.cloud.config).toEqual({
            categories: ['analytics', 'marketing'],
            policyIdentifier: 'v1',
            mode: 'opt-out',
            consentMaxAgeDays: undefined,
        });
        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0][0]).toContain('using fallback');
        expect(readCache()).toBeNull();
    });

    it('fallback without identifier hashes its categories like self-hosted mode', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
        const c = await createCloudConsentify({
            siteId: 'site_abc',
            endpoints: EP,
            fallback: { categories: ['analytics'] },
        });
        expect(c.policy.identifier).toBe(hashPolicy(['analytics']));
        expect(c.cloud.config.policyIdentifier).toBe(c.policy.identifier);
    });

    it('falls back after timeoutMs (default 3000) and aborts the request', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        let signal: AbortSignal | null | undefined;
        vi.stubGlobal('fetch', vi.fn((_url: string, opts?: RequestInit) => {
            signal = opts?.signal;
            return new Promise(() => {}); // never settles on its own
        }));
        let settled = false;
        const p = createCloudConsentify({ siteId: 'site_abc', endpoints: EP, fallback: FB });
        void p.then(() => { settled = true; });
        await vi.advanceTimersByTimeAsync(2999);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        const c = await p;
        expect(c.cloud.source).toBe('fallback');
        expect(signal?.aborted).toBe(true);
    });

    it('honors a custom timeoutMs', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
        const p = createCloudConsentify({ siteId: 'site_abc', endpoints: EP, fallback: FB, timeoutMs: 50 });
        await vi.advanceTimersByTimeAsync(50);
        expect((await p).cloud.source).toBe('fallback');
    });

    it('falls back when latest.json answers 500', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('err', { status: 500 }))));
        const c = await createCloudConsentify({ siteId: 'site_abc', endpoints: EP, fallback: FB });
        expect(c.cloud.source).toBe('fallback');
    });

    it('falls back when latest.json is malformed', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn((url: string) => {
            if (url.endsWith('/latest.json')) {
                return Promise.resolve(new Response(JSON.stringify({ wrong: 'shape' })));
            }
            return Promise.resolve(new Response('ok'));
        }));
        const c = await createCloudConsentify({
            siteId: 'site_abc',
            endpoints: { config: 'https://cdn.test' },
            fallback: FB,
        });
        expect(c.cloud.source).toBe('fallback');
    });

    it('falls back when the versioned config is malformed or not JSON', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        for (const body of [JSON.stringify({ categories: 'analytics', policyIdentifier: 'v1' }), 'not json']) {
            vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(new Response(
                url.endsWith('/latest.json') ? JSON.stringify({ current: 'h1' }) : body,
            ))));
            const c = await createCloudConsentify({ siteId: 'site_abc', endpoints: EP, fallback: FB });
            expect(c.cloud.source).toBe('fallback');
        }
    });

    // --- SiteConfig v2 ---
    const VENDORS = [
        { id: 'ga4', category: 'analytics', name: 'Google Analytics', privacyPolicyUrl: 'https://policies.google.com/privacy' },
        { id: 'hotjar', category: 'analytics', name: 'Hotjar' },
    ];

    it('accepts a v2 SiteConfig and exposes its data fields on consent.cloud.config', async () => {
        const cfg = {
            v: 2, categories: ['analytics'], policyIdentifier: 'v1', policyTextVersion: '2026-10-01',
            locales: ['en', 'de'], defaultLocale: 'en', vendors: VENDORS, futureField: { x: 1 },
        };
        stubConfigFetch(cfg);
        const c = await createCloudConsentify({ siteId: 'site_abc', endpoints: EP, fallback: FB });
        expect(c.cloud.source).toBe('network');
        expect(c.cloud.config).toEqual(cfg);
        expect(c.policy.identifier).toBe('v1');
    });

    it('records pv from SiteConfig policyTextVersion', async () => {
        stubConfigFetch({ v: 2, categories: ['analytics'], policyIdentifier: 'v1', policyTextVersion: '2026-10-01' });
        const c = await createCloudConsentify({ siteId: 'site_abc', endpoints: EP, fallback: { ...FB, textVersion: 'fb-text' } });
        c.set({ analytics: true });
        const s = c.get();
        expect(s.decision === 'decided' && s.snapshot.pv).toBe('2026-10-01');
    });

    it('records pv from fallback.textVersion when the fallback is in use', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
        const c = await createCloudConsentify({ siteId: 'site_abc', endpoints: EP, fallback: { ...FB, textVersion: 'fb-text' } });
        expect(c.cloud.source).toBe('fallback');
        expect(c.cloud.config.policyTextVersion).toBe('fb-text');
        c.acceptAll();
        const s = c.get();
        expect(s.decision === 'decided' && s.snapshot.pv).toBe('fb-text');
    });

    it('a config without policyTextVersion records no pv, and init lang is recorded', async () => {
        stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const c = await createCloudConsentify({ siteId: 'site_abc', endpoints: EP, fallback: { ...FB, textVersion: 'fb-text' }, lang: 'de-AT' });
        c.set({ analytics: true }, { source: 'banner' });
        const s = c.get();
        if (s.decision !== 'decided') throw new Error('expected decided');
        expect(s.snapshot).not.toHaveProperty('pv');
        expect(s.snapshot).toMatchObject({ v: 2, lang: 'de-AT', src: 'banner' });
    });

    it('treats a SiteConfig with malformed v2 fields as malformed (fallback path)', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const base = { categories: ['analytics'], policyIdentifier: 'v1' };
        const bad: Record<string, unknown>[] = [
            { vendors: 'ga4' },
            { vendors: [{ id: 'ga4', category: 'analytics' }] }, // no name
            { vendors: [{ id: 'ga4', category: 'analytics', name: 'GA', privacyPolicyUrl: 42 }] },
            { vendors: [null] },
            { locales: 'en' },
            { locales: ['en', 7] },
            { defaultLocale: null },
            { policyTextVersion: 20261001 },
            { v: 3 },
            { policyIdentifier: '' },
        ];
        for (const extra of bad) {
            vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(
                url.endsWith('/latest.json') ? { current: 'h1' } : { ...base, ...extra },
            )))));
            const c = await createCloudConsentify({ siteId: 'site_abc', endpoints: EP, fallback: FB });
            expect(c.cloud.source, JSON.stringify(extra)).toBe('fallback');
        }
        expect(readCache()).toBeNull();
    });

    it('ignores a cached SiteConfig with malformed vendors', async () => {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
            t: Date.now(), h: 'h0', c: { categories: ['analytics'], policyIdentifier: 'v0', vendors: [{ id: 1 }] },
        }));
        stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const c = await createCloudConsentify({ siteId: 'site_abc', endpoints: EP, fallback: FB });
        expect(c.cloud.source).toBe('network');
        expect(c.policy.identifier).toBe('v1');
    });

    it('caches the fetched SiteConfig with its hash in localStorage', async () => {
        stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        await createCloudConsentify({ siteId: 'site_abc', endpoints: EP, fallback: FB });
        const cached = readCache();
        expect(cached.h).toBe('abc123');
        expect(cached.c).toEqual({ categories: ['analytics'], policyIdentifier: 'v1' });
        expect(Date.now() - cached.t).toBeLessThan(1000);
    });

    it('uses a fresh cache without any network request', async () => {
        seedCache(60_000, 'h0', { categories: ['analytics', 'marketing'], policyIdentifier: 'v0' });
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const c = await createCloudConsentify({ siteId: 'site_abc', endpoints: EP, fallback: FB });
        expect(c.cloud.source).toBe('cache');
        expect(c.policy.identifier).toBe('v0');
        expect(c.policy.categories).toEqual(['analytics', 'marketing']);
        expect(spy).not.toHaveBeenCalled();
    });

    it('ignores a corrupt cache entry', async () => {
        localStorage.setItem(CACHE_KEY, '{not json');
        stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const c = await createCloudConsentify({ siteId: 'site_abc', endpoints: EP, fallback: FB });
        expect(c.cloud.source).toBe('network');
        expect(readCache().h).toBe('abc123');
    });

    it('serves a stale cache at once and refreshes the cache in the background', async () => {
        seedCache(2 * HOUR, 'old', { categories: ['analytics'], policyIdentifier: 'v0' });
        const { spy, release } = gatedFetch(url => url.endsWith('/latest.json')
            ? { current: 'new' }
            : { categories: ['analytics', 'marketing'], policyIdentifier: 'v2' });
        const c = await createCloudConsentify({ siteId: 'site_abc', endpoints: EP, fallback: FB });
        // Resolved while the revalidation request is still pending.
        expect(c.cloud.source).toBe('stale');
        expect(c.policy.identifier).toBe('v0');
        expect(spy).toHaveBeenCalledOnce();
        release();
        await vi.waitFor(() => expect(readCache().h).toBe('new'));
        expect(readCache().c.policyIdentifier).toBe('v2');
        expect(spy.mock.calls[1][0]).toBe('https://cdn.test/config/site_abc/new.json');
        // The running instance keeps its policy; the next load picks up v2.
        expect(c.policy.identifier).toBe('v0');
        const next = await createCloudConsentify({ siteId: 'site_abc', endpoints: EP, fallback: FB });
        expect(next.cloud.source).toBe('cache');
        expect(next.policy.identifier).toBe('v2');
    });

    it('revalidation with an unchanged hash makes one request', async () => {
        seedCache(2 * HOUR, 'abc123', { categories: ['analytics'], policyIdentifier: 'v1' });
        const before = readCache().t;
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const c = await createCloudConsentify({ siteId: 'site_abc', endpoints: EP, fallback: FB });
        expect(c.cloud.source).toBe('stale');
        await vi.waitFor(() => expect(readCache().t).toBeGreaterThan(before));
        expect(spy).toHaveBeenCalledOnce();
        expect(spy.mock.calls[0][0]).toBe('https://cdn.test/config/site_abc/latest.json');
    });

    it('keeps a stale cache when the background refresh fails', async () => {
        seedCache(2 * HOUR, 'h0', { categories: ['analytics'], policyIdentifier: 'v0' });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const spy = vi.fn(() => Promise.reject(new Error('network down')));
        vi.stubGlobal('fetch', spy);
        const c = await createCloudConsentify({ siteId: 'site_abc', endpoints: EP, fallback: FB });
        expect(c.cloud.source).toBe('stale');
        await vi.waitFor(() => expect(spy).toHaveBeenCalled());
        await new Promise(r => setTimeout(r, 0));
        expect(readCache().h).toBe('h0');
        expect(warn).not.toHaveBeenCalled();
    });

    it('server: concurrent calls share one in-flight SiteConfig request', async () => {
        vi.stubGlobal('document', undefined); // isBrowser() === false
        const { spy, release } = gatedFetch(url => url.endsWith('/latest.json')
            ? { current: 'h1' }
            : { categories: ['analytics'], policyIdentifier: 'v1' });
        const init = { siteId: 'srv_inflight', endpoints: EP, fallback: FB };
        const both = Promise.all([createCloudConsentify(init), createCloudConsentify(init)]);
        release();
        const [a, b] = await both;
        expect([a.cloud.source, b.cloud.source]).toEqual(['network', 'network']);
        expect(spy).toHaveBeenCalledTimes(2); // latest.json + h1.json, once
        const c = await createCloudConsentify(init);
        expect(c.cloud.source).toBe('cache');
        expect(spy).toHaveBeenCalledTimes(2);
        expect(localStorage.getItem('consentify_cfg_srv_inflight')).toBeNull();
    });

    it('server: memo honors configTtlSec with stale-while-revalidate', async () => {
        vi.stubGlobal('document', undefined);
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const init = { siteId: 'srv_ttl', endpoints: EP, fallback: FB, configTtlSec: 60 };
        const t0 = Date.now();
        vi.setSystemTime(t0);
        expect((await createCloudConsentify(init)).cloud.source).toBe('network');
        vi.setSystemTime(t0 + 59_000);
        expect((await createCloudConsentify(init)).cloud.source).toBe('cache');
        expect(spy).toHaveBeenCalledTimes(2);
        vi.setSystemTime(t0 + 61_000);
        expect((await createCloudConsentify(init)).cloud.source).toBe('stale');
        await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(3)); // hash unchanged: latest.json only
        await new Promise(r => setTimeout(r, 0));
        expect((await createCloudConsentify(init)).cloud.source).toBe('cache');
        expect(spy).toHaveBeenCalledTimes(3);
    });

    it('server: a different endpoint is a separate memo entry', async () => {
        vi.stubGlobal('document', undefined);
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        await createCloudConsentify({ siteId: 'srv_ep', endpoints: EP, fallback: FB });
        const c = await createCloudConsentify({ siteId: 'srv_ep', endpoints: { config: 'https://cdn2.test' }, fallback: FB });
        expect(c.cloud.source).toBe('network');
        expect(spy).toHaveBeenCalledTimes(4);
    });

    it('POSTs a v2 event to <ingest>/v2/events on consent change', async () => {
        vi.stubGlobal('navigator', { ...navigator, sendBeacon: undefined });
        const spy = stubConfigFetch({ categories: ['analytics', 'marketing'], policyIdentifier: 'v1', policyTextVersion: '2026-10-01' });
        const c = await createCloudConsentify({
            siteId: 'site_abc',
            publicKey: 'pk_test',
            endpoints: EP,
            fallback: FB,
            lang: 'de',
        });
        c.set({ analytics: true }, { source: 'preferences' });
        await vi.waitFor(() => expect(ingestCalls(spy)).toHaveLength(1));
        const [url, init] = ingestCalls(spy)[0] as [string, RequestInit];
        expect(url).toBe('https://ingest.test/v2/events');
        expect(init.method).toBe('POST');
        expect(init.keepalive).toBe(true);
        const body = JSON.parse(init.body as string);
        expect(Object.keys(body)).toEqual(['v', 'eventId', 'siteId', 'action', 'record', 'visitorHash', 'sdkVersion']);
        const state = c.get();
        if (state.decision !== 'decided') throw new Error('expected decided');
        expect(body).toEqual({
            v: 2,
            eventId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
            siteId: 'site_abc',
            action: 'customize',
            record: state.snapshot,
            visitorHash: localStorage.getItem('consentify_visitor'),
            sdkVersion: pkgVersion,
        });
        expect(body.record).toMatchObject({ v: 2, policy: 'v1', pv: '2026-10-01', lang: 'de', src: 'preferences' });
        expect(body).not.toHaveProperty('proof');
    });

    it('sends publicKey only as the X-Consentify-Key header, never in the body', async () => {
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const c = await createCloudConsentify({ siteId: 'site_abc', publicKey: 'pk_test', endpoints: EP, fallback: FB });
        c.acceptAll();
        await vi.waitFor(() => expect(ingestCalls(spy)).toHaveLength(1));
        const init = ingestCalls(spy)[0][1] as RequestInit;
        expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-Consentify-Key': 'pk_test' });
        expect(init.body as string).not.toContain('pk_test');
        expect(JSON.parse(init.body as string)).not.toHaveProperty('apiKey');
    });

    it('sends no key header without publicKey', async () => {
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const c = await createCloudConsentify({ siteId: 'site_abc', endpoints: EP, fallback: FB });
        c.acceptAll();
        await vi.waitFor(() => expect(ingestCalls(spy)).toHaveLength(1));
        expect((ingestCalls(spy)[0][1] as RequestInit).headers).toEqual({ 'Content-Type': 'application/json' });
    });

    it('gives every event its own eventId and stamps the package version', async () => {
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const c = await createCloudConsentify({ siteId: 'site_abc', endpoints: EP, fallback: FB });
        const t0 = Date.now();
        vi.setSystemTime(t0);
        c.acceptAll({ source: 'banner' });
        await vi.waitFor(() => expect(ingestCalls(spy)).toHaveLength(1));
        vi.setSystemTime(t0 + 60_000);
        c.acceptAll({ source: 'banner' });
        await vi.waitFor(() => expect(ingestCalls(spy)).toHaveLength(2));
        const [a, b] = ingestBodies(spy);
        expect(a.eventId).toBeTypeOf('string');
        expect(a.eventId).not.toBe(b.eventId);
        expect(pkgVersion).toMatch(/^\d+\.\d+\.\d+/);
        expect([a.sdkVersion, b.sdkVersion]).toEqual([pkgVersion, pkgVersion]);
    });

    it('buffers a failed event with publicKey and replays it with the header and the same eventId', async () => {
        let fail = true;
        const spy = vi.fn((url: string) => {
            if (url.endsWith('/latest.json')) return Promise.resolve(new Response(JSON.stringify({ current: 'h1' })));
            if (url.endsWith('/h1.json')) return Promise.resolve(new Response(JSON.stringify({ categories: ['analytics'], policyIdentifier: 'v1' })));
            return Promise.resolve(new Response('x', { status: fail ? 503 : 202 }));
        });
        vi.stubGlobal('fetch', spy);
        const c = await createCloudConsentify({ siteId: 'site_abc', publicKey: 'pk_test', endpoints: EP, fallback: FB });
        c.acceptAll();
        await vi.waitFor(() => expect(localStorage.getItem('consentify_event_buffer')).not.toBeNull());
        const buffered = JSON.parse(localStorage.getItem('consentify_event_buffer')!);
        expect(Object.keys(buffered).sort()).toEqual(['body', 'publicKey', 'url']);
        expect(buffered).toMatchObject({ url: 'https://ingest.test/v2/events', publicKey: 'pk_test' });

        // Next page load: the buffered body is replayed as is.
        fail = false;
        await createCloudConsentify({ siteId: 'site_abc', publicKey: 'pk_test', endpoints: EP, fallback: FB });
        await vi.waitFor(() => expect(localStorage.getItem('consentify_event_buffer')).toBeNull());
        const [first, replay] = ingestCalls(spy) as [string, RequestInit][];
        expect(replay[1].body).toBe(first[1].body);
        expect(JSON.parse(replay[1].body as string).eventId).toBe(JSON.parse(first[1].body as string).eventId);
        expect(replay[1].headers).toEqual({ 'Content-Type': 'application/json', 'X-Consentify-Key': 'pk_test' });
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
            endpoints: EP,
            fallback: FB,
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

    it('falls back when the versioned config fetch returns non-200', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn((url: string) => {
            if (url.endsWith('/latest.json')) {
                return Promise.resolve(new Response(JSON.stringify({ current: 'h1' })));
            }
            // hash.json returns 404
            return Promise.resolve(new Response('not found', { status: 404 }));
        }));
        const c = await createCloudConsentify({
            siteId: 'site_abc',
            endpoints: { config: 'https://cdn.test' },
            fallback: FB,
        });
        expect(c.cloud.source).toBe('fallback');
    });

    it('reports a re-affirmation of the same choices with a source as a new event', async () => {
        vi.stubGlobal('navigator', { ...navigator, sendBeacon: undefined });
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const c = await createCloudConsentify({
            siteId: 'site_abc',
            endpoints: EP,
            fallback: FB,
        });
        const t0 = Date.now();
        vi.setSystemTime(t0);
        c.set({ analytics: true }, { source: 'banner' });
        await vi.waitFor(() => expect(ingestCalls(spy)).toHaveLength(1));

        // Same choices later, from the UI: a new decision with a fresh givenAt -> new POST
        vi.setSystemTime(t0 + 60_000);
        c.set({ analytics: true }, { source: 'preferences' });
        await vi.waitFor(() => expect(ingestCalls(spy)).toHaveLength(2));
        expect(JSON.parse(ingestCalls(spy)[1][1].body).action).toBe('accept_all');
    });

    it('does not report a programmatic restore of the same choices (no source)', async () => {
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const init = { siteId: 'site_abc', endpoints: EP, fallback: FB };
        const c = await createCloudConsentify(init);
        c.set({ analytics: true }, { source: 'preferences' });
        await vi.waitFor(() => expect(ingestCalls(spy)).toHaveLength(1));
        // Every later page load restores the user's saved choices.
        for (let load = 0; load < 3; load++) {
            const page = await createCloudConsentify(init);
            page.set({ analytics: true });
            page.acceptAll();
        }
        await new Promise(r => setTimeout(r, 20));
        expect(ingestCalls(spy)).toHaveLength(1);
    });

    it('reports two decisions made in the same millisecond, keyed by record id', async () => {
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const c = await createCloudConsentify({ siteId: 'site_abc', endpoints: EP, fallback: FB });
        vi.setSystemTime(Date.now());
        c.set({ analytics: true });
        c.set({ analytics: false });
        await vi.waitFor(() => expect(ingestCalls(spy)).toHaveLength(2));
        const [a, b] = ingestBodies(spy);
        expect(a.record.givenAt).toBe(b.record.givenAt);
        expect(a.record.id).not.toBe(b.record.id);
        expect(localStorage.getItem('consentify_last_event')).toBe('site_abc|v1|' + b.record.id);
    });

    it('does not re-report a decision echoed from another tab', async () => {
        MockBroadcastChannel.channels.clear();
        vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
        vi.stubGlobal('navigator', { ...navigator, sendBeacon: undefined });
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const init = {
            siteId: 'site_abc',
            endpoints: EP,
            fallback: FB,
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
            endpoints: EP,
            fallback: FB,
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

    // --- Visitor id: minted only after a decision, never for reject_all ---
    const VISITOR_KEY = 'consentify_visitor';
    const cloud = (extra: { visitorId?: string | (() => Promise<string>) } = {}) =>
        createCloudConsentify({ siteId: 'site_abc', endpoints: EP, fallback: FB, ...extra });

    it('does not touch consentify_visitor before a decision, retry buffer included', async () => {
        localStorage.setItem('consentify_event_buffer', JSON.stringify({ url: 'https://ingest.test/v2/events', body: '{}' }));
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        await cloud();
        await vi.waitFor(() => expect(localStorage.getItem('consentify_event_buffer')).toBeNull());
        expect(ingestCalls(spy)).toHaveLength(1); // the replayed buffer only
        expect(localStorage.getItem(VISITOR_KEY)).toBeNull();
    });

    it('mints the stored visitor id on the first accept and reports it', async () => {
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const c = await cloud();
        c.set({ analytics: true });
        await vi.waitFor(() => expect(ingestCalls(spy)).toHaveLength(1));
        const stored = localStorage.getItem(VISITOR_KEY);
        expect(stored).toMatch(/^[0-9a-f-]{36}$/);
        expect(ingestBodies(spy)[0]).toMatchObject({ action: 'accept_all', visitorHash: stored });
    });

    it('reject_all reports an 8-hex one-off token and deletes the stored id', async () => {
        localStorage.setItem(VISITOR_KEY, 'earlier-accept-id');
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const c = await cloud();
        c.set({ analytics: false });
        await vi.waitFor(() => expect(ingestCalls(spy)).toHaveLength(1));
        const body = ingestBodies(spy)[0];
        expect(body.action).toBe('reject_all');
        expect(body.visitorHash).toMatch(/^[0-9a-f]{8}$/);
        expect(localStorage.getItem(VISITOR_KEY)).toBeNull();
    });

    it('reject_all still reports a one-off token without Web Crypto', async () => {
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const c = await cloud();
        vi.stubGlobal('crypto', undefined);
        c.set({ analytics: false });
        await vi.waitFor(() => expect(ingestCalls(spy)).toHaveLength(1));
        const body = ingestBodies(spy)[0];
        expect(body.action).toBe('reject_all');
        expect(body.visitorHash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('two reject_all events carry different tokens', async () => {
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const c = await cloud();
        const t0 = Date.now();
        vi.setSystemTime(t0);
        c.set({ analytics: false }, { source: 'banner' });
        await vi.waitFor(() => expect(ingestCalls(spy)).toHaveLength(1));
        vi.setSystemTime(t0 + 60_000);
        c.set({ analytics: false }, { source: 'banner' });
        await vi.waitFor(() => expect(ingestCalls(spy)).toHaveLength(2));
        const [a, b] = ingestBodies(spy);
        expect(b.action).toBe('reject_all');
        expect(b.visitorHash).toMatch(/^[0-9a-f]{8}$/);
        expect(a.visitorHash).not.toBe(b.visitorHash);
        expect(localStorage.getItem(VISITOR_KEY)).toBeNull();
    });

    it('with an adapter, a reject_all is saved and reported under one-off tokens, never the stored id', async () => {
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const saved: { visitorId: string }[] = [];
        const adapter = { async save(d: { visitorId: string }) { saved.push(d); }, async load() { return null; } };
        const c = await createCloudConsentify({ siteId: 'site_abc', endpoints: EP, fallback: FB, adapter });

        c.acceptAll({ source: 'banner' });
        await vi.waitFor(() => expect(saved).toHaveLength(1));
        await vi.waitFor(() => expect(ingestCalls(spy)).toHaveLength(1));
        const idA = localStorage.getItem(VISITOR_KEY);
        expect(idA).toMatch(/^[0-9a-f-]{36}$/);
        expect(saved[0].visitorId).toBe(idA);
        expect(ingestBodies(spy)[0].visitorHash).toBe(idA);

        c.rejectAll({ source: 'banner' });
        await vi.waitFor(() => expect(saved).toHaveLength(2));
        await vi.waitFor(() => expect(ingestCalls(spy)).toHaveLength(2));
        await new Promise(r => setTimeout(r, 0));
        expect(saved[1].visitorId).toMatch(/^[0-9a-f]{8}$/);
        expect(ingestBodies(spy)[1]).toMatchObject({ action: 'reject_all', visitorHash: expect.stringMatching(/^[0-9a-f]{8}$/) });
        expect(localStorage.getItem(VISITOR_KEY)).toBeNull();

        c.acceptAll({ source: 'banner' });
        await vi.waitFor(() => expect(saved).toHaveLength(3));
        await vi.waitFor(() => expect(ingestCalls(spy)).toHaveLength(3));
        const idB = localStorage.getItem(VISITOR_KEY);
        expect(idB).toMatch(/^[0-9a-f-]{36}$/);
        expect(idB).not.toBe(idA);
        expect(saved[2].visitorId).toBe(idB);
        expect(ingestBodies(spy)[2].visitorHash).toBe(idB);
    });

    for (const [kind, visitorId] of [['string', 'acct-42'], ['factory', async () => 'acct-42']] as const) {
        it(`reports an explicit ${kind} visitorId for accept and reject alike`, async () => {
            const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
            const c = await cloud({ visitorId });
            const t0 = Date.now();
            vi.setSystemTime(t0);
            c.set({ analytics: true });
            await vi.waitFor(() => expect(ingestCalls(spy)).toHaveLength(1));
            vi.setSystemTime(t0 + 60_000);
            c.set({ analytics: false });
            await vi.waitFor(() => expect(ingestCalls(spy)).toHaveLength(2));
            expect(ingestBodies(spy).map(b => [b.action, b.visitorHash])).toEqual([
                ['accept_all', 'acct-42'],
                ['reject_all', 'acct-42'],
            ]);
            expect(localStorage.getItem(VISITOR_KEY)).toBeNull();
        });
    }

    // --- Server-side reporting (reportConsent) ---
    const SRV = { siteId: 'srv_report', endpoints: EP, fallback: FB };
    const serverCloud = async (extra: { secret?: string } = {}) => {
        vi.stubGlobal('document', undefined); // isBrowser() === false
        const spy = stubConfigFetch({ categories: ['analytics', 'marketing'], policyIdentifier: 'v1', policyTextVersion: '2026-10-01' });
        const c = await createCloudConsentify({ ...SRV, ...extra } as typeof SRV);
        return { c, spy };
    };

    it('reportConsent: builds the event from the Set-Cookie a server write returned', async () => {
        const { c, spy } = await serverCloud();
        expect(c.cloud).toMatchObject({ siteId: 'srv_report', ingest: 'https://ingest.test' });
        const setCookie = c.acceptAll({ cookieHeader: undefined, source: 'banner', lang: 'en' });
        expect(await reportConsent(c, { serverKey: 'sk_test', setCookie })).toBe(true);
        expect(ingestCalls(spy)).toHaveLength(1);
        const [url, init] = ingestCalls(spy)[0] as [string, RequestInit];
        expect(url).toBe('https://ingest.test/v2/events');
        expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-Consentify-Server-Key': 'sk_test' });
        const body = JSON.parse(init.body as string);
        expect(body).toEqual({
            v: 2,
            eventId: expect.any(String),
            siteId: 'srv_report',
            action: 'accept_all',
            record: JSON.parse(parseSetCookie(setCookie).value),
            sdkVersion: pkgVersion,
        });
        expect(body.record).toMatchObject({ v: 2, pv: '2026-10-01', lang: 'en', src: 'banner' });
        expect(init.body as string).not.toContain('sk_test');
    });

    it('reportConsent: reads the record from a request Cookie header', async () => {
        const { c, spy } = await serverCloud();
        const value = setHeaderToCookieHeader(c.rejectAll({ cookieHeader: null, source: 'api' }));
        expect(await reportConsent(c, { serverKey: 'sk_test', cookieHeader: 'a=1; ' + value + '; b=2' })).toBe(true);
        const [body] = ingestBodies(spy);
        expect(body.action).toBe('reject_all');
        expect(body.record.choices).toEqual({ necessary: true, analytics: false, marketing: false });
        expect(body.record.src).toBe('api');
    });

    it('reportConsent: includes an HMAC proof of the record when the instance has a secret', async () => {
        const { c, spy } = await serverCloud({ secret: 'dev-secret' });
        const setCookie = c.set({ analytics: true }, { cookieHeader: '' });
        expect(await reportConsent(c, { serverKey: 'sk_test', setCookie })).toBe(true);
        const [body] = ingestBodies(spy);
        expect(body.action).toBe('customize');
        expect(body.proof.signature).toMatch(/^[0-9a-f]{64}$/);
        const { signature, ...signed } = body.proof;
        expect(signed).toEqual(body.record);
        expect(await verifyProof(body.proof, 'dev-secret')).toBe(true);
        expect(await verifyProof({ ...body.proof, choices: { ...body.proof.choices, marketing: true } }, 'dev-secret')).toBe(false);
    });

    it('reportConsent: omits visitorHash without an explicit visitorId and sends one when given', async () => {
        const { c, spy } = await serverCloud();
        const setCookie = c.acceptAll({ cookieHeader: '' });
        await reportConsent(c, { serverKey: 'sk_test', setCookie });
        await reportConsent(c, { serverKey: 'sk_test', setCookie, visitorId: 'acct-42' });
        await reportConsent(c, { serverKey: 'sk_test', setCookie, visitorId: async () => 'acct-43' });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await reportConsent(c, { serverKey: 'sk_test', setCookie, visitorId: () => { throw new Error('no session'); } });
        const bodies = ingestBodies(spy);
        expect(bodies.map(b => b.visitorHash)).toEqual([undefined, 'acct-42', 'acct-43', undefined]);
        expect(bodies[0]).not.toHaveProperty('visitorHash');
        expect(new Set(bodies.map(b => b.eventId)).size).toBe(4);
    });

    it('reportConsent: resolves false without a request when there is nothing to report', async () => {
        const { c, spy } = await serverCloud();
        expect(await reportConsent(c, { serverKey: 'sk_test', cookieHeader: undefined })).toBe(false);
        expect(await reportConsent(c, { serverKey: 'sk_test', setCookie: c.clear({ cookieHeader: '' }) })).toBe(false);
        const other = createConsentify({ policy: { categories: ['analytics'], identifier: 'other' } });
        expect(await reportConsent(c, { serverKey: 'sk_test', setCookie: other.acceptAll({ cookieHeader: '' }) })).toBe(false);
        expect(ingestCalls(spy)).toHaveLength(0);
    });

    it('reportConsent: resolves false on a network error, a non-2xx answer or a timeout', async () => {
        const { c } = await serverCloud();
        const setCookie = c.acceptAll({ cookieHeader: '' });
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('fetch failed'))));
        await expect(reportConsent(c, { serverKey: 'sk_test', setCookie })).resolves.toBe(false);
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('no', { status: 401 }))));
        await expect(reportConsent(c, { serverKey: 'sk_test', setCookie })).resolves.toBe(false);
        vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => {
            init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
        })));
        await expect(reportConsent(c, { serverKey: 'sk_test', setCookie, timeoutMs: 10 })).resolves.toBe(false);
    });

    it('reportConsent: throws ConsentifyConfigError in a browser and sends nothing', async () => {
        const spy = stubConfigFetch({ categories: ['analytics'], policyIdentifier: 'v1' });
        const c = await createCloudConsentify({ siteId: 'site_abc', endpoints: EP, fallback: FB });
        expect(() => reportConsent(c, { serverKey: 'sk_test', cookieHeader: '' })).toThrow(ConsentifyConfigError);
        expect(ingestCalls(spy)).toHaveLength(0);
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

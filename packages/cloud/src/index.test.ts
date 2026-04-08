import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ConsentifySubscribable, ConsentState } from '@consentify/core';
import { enableCloud } from './index';

type TestCategory = 'analytics' | 'marketing';

interface MockInstance extends ConsentifySubscribable<TestCategory> {
    policy: { categories: readonly string[]; identifier: string };
    _triggerSubscribers: () => void;
    _setState: (state: ConsentState<TestCategory>) => void;
}

function createMockInstance(
    initialState: ConsentState<TestCategory> = { decision: 'unset' },
): MockInstance {
    let state = initialState;
    const listeners = new Set<() => void>();

    return {
        policy: { categories: ['necessary', 'analytics', 'marketing'], identifier: 'test-policy' },
        subscribe(cb: () => void) {
            listeners.add(cb);
            return () => listeners.delete(cb);
        },
        get: () => state,
        getServerSnapshot: () => ({ decision: 'unset' as const }),
        _triggerSubscribers() {
            for (const cb of listeners) cb();
        },
        _setState(newState: ConsentState<TestCategory>) {
            state = newState;
            this._triggerSubscribers();
        },
    };
}

const decidedState = (
    choices: Record<string, boolean> = { necessary: true, analytics: true, marketing: true },
): ConsentState<TestCategory> => ({
    decision: 'decided',
    snapshot: {
        policy: 'test-policy',
        givenAt: new Date().toISOString(),
        choices: choices as any,
    },
});

describe('enableCloud', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchSpy = vi.fn(() => Promise.resolve(new Response('ok')));
        vi.stubGlobal('fetch', fetchSpy);
        const store: Record<string, string> = {};
        vi.stubGlobal('localStorage', {
            getItem(key: string) { return store[key] ?? null; },
            setItem(key: string, val: string) { store[key] = val; },
            removeItem(key: string) { delete store[key]; },
            clear() { for (const k of Object.keys(store)) delete store[k]; },
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('posts event with correct payload on state change', () => {
        const instance = createMockInstance();
        enableCloud(instance, { siteId: 'site_123' });

        instance._setState(decidedState());

        expect(fetchSpy).toHaveBeenCalledOnce();
        const [url, opts] = fetchSpy.mock.calls[0];
        expect(url).toBe('https://consentify.dev/api/consent/events');
        expect(opts.method).toBe('POST');

        const body = JSON.parse(opts.body);
        expect(body.siteId).toBe('site_123');
        expect(body.action).toBe('accept_all');
        expect(body.categories).toEqual({ necessary: true, analytics: true, marketing: true });
        expect(body.visitorHash).toBeTypeOf('string');
        expect(body.policyVersion).toBe('test-policy');
    });

    it('derives accept_all when all user categories are true', () => {
        const instance = createMockInstance();
        enableCloud(instance, { siteId: 'site_123' });

        instance._setState(decidedState({ necessary: true, analytics: true, marketing: true }));

        const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(body.action).toBe('accept_all');
    });

    it('derives reject_all when all user categories are false', () => {
        const instance = createMockInstance();
        enableCloud(instance, { siteId: 'site_123' });

        instance._setState(decidedState({ necessary: true, analytics: false, marketing: false }));

        const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(body.action).toBe('reject_all');
    });

    it('derives customize when categories are mixed', () => {
        const instance = createMockInstance();
        enableCloud(instance, { siteId: 'site_123' });

        instance._setState(decidedState({ necessary: true, analytics: true, marketing: false }));

        const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(body.action).toBe('customize');
    });

    it('deduplicates: same state does not POST twice', () => {
        const instance = createMockInstance();
        enableCloud(instance, { siteId: 'site_123' });

        const state = decidedState();
        instance._setState(state);
        expect(fetchSpy).toHaveBeenCalledOnce();

        // Trigger again with same state
        instance._triggerSubscribers();
        expect(fetchSpy).toHaveBeenCalledOnce();
    });

    it('posts again when choices change', () => {
        const instance = createMockInstance();
        enableCloud(instance, { siteId: 'site_123' });

        instance._setState(decidedState({ necessary: true, analytics: true, marketing: true }));
        expect(fetchSpy).toHaveBeenCalledTimes(1);

        instance._setState(decidedState({ necessary: true, analytics: false, marketing: false }));
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('generates visitor hash and stores in localStorage', () => {
        const instance = createMockInstance();
        enableCloud(instance, { siteId: 'site_123' });

        instance._setState(decidedState());

        const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(body.visitorHash).toBeTypeOf('string');
        expect(body.visitorHash.length).toBeGreaterThan(0);

        // Stored in localStorage
        expect(localStorage.getItem('consentify_visitor')).toBe(body.visitorHash);
    });

    it('reuses stored visitor hash across calls', () => {
        localStorage.setItem('consentify_visitor', 'existing-hash-123');

        const instance = createMockInstance();
        enableCloud(instance, { siteId: 'site_123' });

        instance._setState(decidedState());

        const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(body.visitorHash).toBe('existing-hash-123');
    });

    it('works when localStorage is unavailable', () => {
        vi.stubGlobal('localStorage', {
            getItem() { throw new Error('SecurityError'); },
            setItem() { throw new Error('SecurityError'); },
            removeItem() { throw new Error('SecurityError'); },
        });

        const instance = createMockInstance();
        enableCloud(instance, { siteId: 'site_123' });

        instance._setState(decidedState());

        expect(fetchSpy).toHaveBeenCalledOnce();
        const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(body.visitorHash).toBeTypeOf('string');
    });

    it('returns no-op unsubscribe on server (typeof window undefined)', () => {
        const origWindow = globalThis.window;
        // @ts-expect-error - simulating SSR
        delete globalThis.window;

        const instance = createMockInstance();
        const unsub = enableCloud(instance, { siteId: 'site_123' });

        expect(unsub).toBeTypeOf('function');
        expect(fetchSpy).not.toHaveBeenCalled();

        globalThis.window = origWindow;
    });

    it('does not throw on fetch failure', async () => {
        fetchSpy.mockRejectedValue(new Error('Network error'));

        const instance = createMockInstance();
        enableCloud(instance, { siteId: 'site_123' });

        expect(() => instance._setState(decidedState())).not.toThrow();

        // Let any promises settle
        await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    });

    it('includes X-API-Key header when apiKey is provided', () => {
        const instance = createMockInstance();
        enableCloud(instance, { siteId: 'site_123', apiKey: 'sk_test_abc' });

        instance._setState(decidedState());

        const headers = fetchSpy.mock.calls[0][1].headers;
        expect(headers['X-API-Key']).toBe('sk_test_abc');
    });

    it('does not include X-API-Key header when apiKey is absent', () => {
        const instance = createMockInstance();
        enableCloud(instance, { siteId: 'site_123' });

        instance._setState(decidedState());

        const headers = fetchSpy.mock.calls[0][1].headers;
        expect(headers['X-API-Key']).toBeUndefined();
    });

    it('uses custom endpoint when provided', () => {
        const instance = createMockInstance();
        enableCloud(instance, { siteId: 'site_123', endpoint: 'https://custom.api.com/' });

        instance._setState(decidedState());

        const url = fetchSpy.mock.calls[0][0];
        expect(url).toBe('https://custom.api.com/consent/events');
    });

    it('stops posting after unsubscribe is called', () => {
        const instance = createMockInstance();
        const unsub = enableCloud(instance, { siteId: 'site_123' });

        instance._setState(decidedState());
        expect(fetchSpy).toHaveBeenCalledOnce();

        unsub();

        instance._setState(decidedState({ necessary: true, analytics: false, marketing: false }));
        expect(fetchSpy).toHaveBeenCalledOnce();
    });

    it('posts immediately if state is already decided on init', () => {
        const instance = createMockInstance(decidedState());
        enableCloud(instance, { siteId: 'site_123' });

        expect(fetchSpy).toHaveBeenCalledOnce();
    });

    it('does not post when state is unset', () => {
        const instance = createMockInstance();
        enableCloud(instance, { siteId: 'site_123' });

        // Trigger subscriber without changing to decided
        instance._triggerSubscribers();

        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

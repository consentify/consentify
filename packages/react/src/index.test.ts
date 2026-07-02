import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ConsentifySubscribable, ConsentState } from '@consentify/core';
import { useConsentify } from './index';

type TestCategory = 'analytics' | 'marketing';

function createMockInstance(
    initialState: ConsentState<TestCategory> = { decision: 'unset' },
) {
    let state = initialState;
    const listeners = new Set<() => void>();

    return {
        subscribe(cb: () => void) {
            listeners.add(cb);
            return () => { listeners.delete(cb); };
        },
        get: () => state,
        getServerSnapshot: () => ({ decision: 'unset' as const }),
        isGranted(category: string): boolean {
            if (category === 'necessary') return true;
            if (state.decision === 'decided') {
                return !!(state.snapshot.choices as Record<string, boolean>)[category];
            }
            return false;
        },
        setState(newState: ConsentState<TestCategory>) {
            state = newState;
            for (const cb of listeners) cb();
        },
    };
}

const decidedState: ConsentState<TestCategory> = {
    decision: 'decided',
    snapshot: {
        policy: 'test',
        givenAt: new Date().toISOString(),
        choices: { necessary: true, analytics: true, marketing: false },
    },
};

describe('useConsentify', () => {
    it('returns initial unset state', () => {
        const instance = createMockInstance();
        const { result } = renderHook(() => useConsentify(instance));
        expect(result.current).toEqual({ decision: 'unset' });
    });

    it('returns decided state from instance', () => {
        const instance = createMockInstance(decidedState);
        const { result } = renderHook(() => useConsentify(instance));
        expect(result.current.decision).toBe('decided');
        if (result.current.decision === 'decided') {
            expect(result.current.snapshot.choices.analytics).toBe(true);
        }
    });

    it('re-renders when state changes', () => {
        const instance = createMockInstance();
        const { result } = renderHook(() => useConsentify(instance));

        expect(result.current.decision).toBe('unset');

        act(() => instance.setState(decidedState));

        expect(result.current.decision).toBe('decided');
    });

    it('unsubscribes on unmount', () => {
        const instance = createMockInstance();
        const unsubSpy = vi.fn();
        const origSubscribe = instance.subscribe;
        instance.subscribe = (cb: () => void) => {
            const unsub = origSubscribe(cb);
            return () => { unsubSpy(); return unsub(); };
        };

        const { unmount } = renderHook(() => useConsentify(instance));
        unmount();

        expect(unsubSpy).toHaveBeenCalled();
    });

    it('works with minimal ConsentifySubscribable interface', () => {
        const state: ConsentState<TestCategory> = { decision: 'unset' };
        const minimal: ConsentifySubscribable<TestCategory> = {
            subscribe: () => {
                // No-op but must return valid unsubscribe
                return () => {};
            },
            get: () => state,
            getServerSnapshot: () => state,
        };

        const { result } = renderHook(() => useConsentify(minimal));
        expect(result.current.decision).toBe('unset');
    });
});

describe('useConsentify with category overload', () => {
    it('returns true when category is granted', () => {
        const instance = createMockInstance(decidedState);
        const { result } = renderHook(() => useConsentify(instance, 'analytics'));
        expect(result.current).toBe(true);
    });

    it('returns false when category is denied', () => {
        const instance = createMockInstance(decidedState);
        const { result } = renderHook(() => useConsentify(instance, 'marketing'));
        expect(result.current).toBe(false);
    });

    it('returns false when state is unset', () => {
        const instance = createMockInstance();
        const { result } = renderHook(() => useConsentify(instance, 'analytics'));
        expect(result.current).toBe(false);
    });

    it('returns true for necessary category always', () => {
        const instance = createMockInstance();
        const { result } = renderHook(() => useConsentify(instance, 'necessary'));
        expect(result.current).toBe(true);
    });

    it('updates when category consent changes', () => {
        const instance = createMockInstance();
        const { result } = renderHook(() => useConsentify(instance, 'analytics'));
        expect(result.current).toBe(false);

        act(() => instance.setState(decidedState));
        expect(result.current).toBe(true);
    });
});

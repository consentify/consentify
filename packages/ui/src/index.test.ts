import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, screen, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import type { ConsentifySubscribable, ConsentState } from '@consentify/core';
import { ConsentGate } from './index';

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
        setState(newState: ConsentState<TestCategory>) {
            state = newState;
            for (const cb of listeners) cb();
        },
    };
}

const decidedState = (
    choices: Record<string, boolean> = { necessary: true, analytics: true, marketing: false },
): ConsentState<TestCategory> => ({
    decision: 'decided',
    snapshot: {
        policy: 'test',
        givenAt: new Date().toISOString(),
        choices: choices as any,
    },
});

function renderGate(
    instance: ReturnType<typeof createMockInstance>,
    category: string,
    fallback?: React.ReactNode,
) {
    return render(
        createElement(ConsentGate, {
            instance,
            category,
            children: createElement('div', { 'data-testid': 'children' }, 'Content'),
            fallback: fallback ?? createElement('div', { 'data-testid': 'fallback' }, 'Blocked'),
        }),
    );
}

describe('ConsentGate', () => {
    afterEach(() => cleanup());

    it('renders children when category is granted', () => {
        const instance = createMockInstance(decidedState());
        renderGate(instance, 'analytics');

        expect(screen.getByTestId('children')).toBeTruthy();
        expect(screen.queryByTestId('fallback')).toBeNull();
    });

    it('renders fallback when category is denied', () => {
        const instance = createMockInstance(decidedState());
        renderGate(instance, 'marketing');

        expect(screen.queryByTestId('children')).toBeNull();
        expect(screen.getByTestId('fallback')).toBeTruthy();
    });

    it('renders fallback when state is unset', () => {
        const instance = createMockInstance();
        renderGate(instance, 'analytics');

        expect(screen.queryByTestId('children')).toBeNull();
        expect(screen.getByTestId('fallback')).toBeTruthy();
    });

    it('always renders children for necessary category', () => {
        const instance = createMockInstance();
        renderGate(instance, 'necessary');

        expect(screen.getByTestId('children')).toBeTruthy();
    });

    it('re-renders when consent changes', () => {
        const instance = createMockInstance();
        const { rerender } = renderGate(instance, 'analytics');

        expect(screen.queryByTestId('children')).toBeNull();

        act(() => instance.setState(decidedState()));

        expect(screen.getByTestId('children')).toBeTruthy();
    });

    it('renders null when no fallback provided and category denied', () => {
        const instance = createMockInstance();
        const { container } = render(
            createElement(ConsentGate, {
                instance,
                category: 'analytics',
                children: createElement('div', { 'data-testid': 'children' }, 'Content'),
            }),
        );

        expect(screen.queryByTestId('children')).toBeNull();
        expect(container.childNodes.length).toBe(0);
    });

    it('renders custom fallback component', () => {
        const instance = createMockInstance();
        renderGate(instance, 'analytics', createElement('span', null, 'Custom fallback'));

        expect(screen.getByText('Custom fallback')).toBeTruthy();
    });

    it('switches from fallback to children when consent is granted', () => {
        const instance = createMockInstance();
        renderGate(instance, 'analytics');

        expect(screen.getByTestId('fallback')).toBeTruthy();

        act(() => instance.setState(decidedState({ necessary: true, analytics: true, marketing: false })));

        expect(screen.getByTestId('children')).toBeTruthy();
        expect(screen.queryByTestId('fallback')).toBeNull();
    });
});

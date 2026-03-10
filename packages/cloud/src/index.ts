import type { ConsentifySubscribable, ConsentState, UserCategory } from '@consentify/core';

const DEFAULT_ENDPOINT = 'https://consentify.dev/api';

type ConsentAction = 'accept_all' | 'reject_all' | 'customize';

export interface EnableCloudOptions {
    siteId: string;
    apiKey?: string;
    endpoint?: string;
}

function generateVisitorHash(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

const VISITOR_KEY = 'consentify_visitor';

function getVisitorHash(): string {
    try {
        const stored = localStorage.getItem(VISITOR_KEY);
        if (stored) return stored;
        const hash = generateVisitorHash();
        localStorage.setItem(VISITOR_KEY, hash);
        return hash;
    } catch {
        return generateVisitorHash();
    }
}

function deriveAction<T extends UserCategory>(
    state: ConsentState<T>,
    categories: readonly string[]
): ConsentAction {
    if (state.decision !== 'decided') return 'customize';
    const choices = state.snapshot.choices as Record<string, boolean>;
    const userCategories = categories.filter(c => c !== 'necessary');
    const allGranted = userCategories.every(c => choices[c] === true);
    const allDenied = userCategories.every(c => !choices[c]);
    if (allGranted) return 'accept_all';
    if (allDenied) return 'reject_all';
    return 'customize';
}

export function enableCloud<T extends string>(
    instance: ConsentifySubscribable<T> & { policy?: { categories: readonly string[]; identifier: string } },
    options: EnableCloudOptions,
): () => void {
    if (typeof window === 'undefined') return () => {};

    const endpoint = (options.endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, '');
    const visitorHash = getVisitorHash();
    let lastPolicy = '';
    let lastChoicesKey = '';

    const postEvent = (state: ConsentState<T>) => {
        if (state.decision !== 'decided') return;

        const choices = state.snapshot.choices as Record<string, boolean>;
        const choicesKey = JSON.stringify(choices);
        const policyKey = state.snapshot.policy;

        if (choicesKey === lastChoicesKey && policyKey === lastPolicy) return;
        lastChoicesKey = choicesKey;
        lastPolicy = policyKey;

        const categories = (instance as any).policy?.categories ?? [];
        const action = deriveAction(state, categories);

        const body: Record<string, unknown> = {
            siteId: options.siteId,
            action,
            categories: choices,
            visitorHash,
            policyVersion: state.snapshot.policy,
        };

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (options.apiKey) {
            headers['X-API-Key'] = options.apiKey;
        }

        try {
            fetch(`${endpoint}/consent/events`, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
            }).catch(() => {});
        } catch {
            // Silent failure - non-blocking
        }
    };

    // Post current state if already decided
    const currentState = instance.get();
    if (currentState.decision === 'decided') {
        postEvent(currentState);
    }

    // Subscribe to future changes
    const unsubscribe = instance.subscribe(() => {
        const state = instance.get();
        postEvent(state);
    });

    return unsubscribe;
}

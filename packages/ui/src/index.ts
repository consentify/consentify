"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import type { ConsentifySubscribable, UserCategory, Necessary } from "@consentify/core";

export interface ConsentGateProps<T extends UserCategory> {
    instance: ConsentifySubscribable<T>;
    category: Necessary | T;
    children: ReactNode;
    fallback?: ReactNode;
}

export function ConsentGate<T extends UserCategory>({
    instance,
    category,
    children,
    fallback = null,
}: ConsentGateProps<T>): ReactNode {
    const state = useSyncExternalStore(
        instance.subscribe,
        instance.get,
        instance.getServerSnapshot,
    );

    if (category === 'necessary') return children;
    if (state.decision === 'decided' && (state.snapshot.choices as Record<string, boolean>)[category]) {
        return children;
    }
    return fallback;
}

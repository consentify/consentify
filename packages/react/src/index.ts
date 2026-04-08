"use client";

import { useSyncExternalStore } from "react";
import type { ConsentifySubscribable, ConsentState, UserCategory, Necessary } from "@consentify/core";

export function useConsentify<T extends UserCategory>(
  instance: ConsentifySubscribable<T>,
): ConsentState<T>;
export function useConsentify<T extends UserCategory>(
  instance: ConsentifySubscribable<T> & { isGranted: (category: Necessary | T) => boolean },
  category: Necessary | T,
): boolean;
export function useConsentify<T extends UserCategory>(
  instance: ConsentifySubscribable<T> & { isGranted?: (category: Necessary | T) => boolean },
  category?: Necessary | T,
): ConsentState<T> | boolean {
  const state = useSyncExternalStore(
    instance.subscribe,
    instance.get,
    instance.getServerSnapshot,
  );

  if (typeof category !== 'undefined') {
    if (category === 'necessary') return true;
    if (state.decision === 'decided') {
      return !!(state.snapshot.choices as Record<string, boolean>)[category];
    }
    return false;
  }

  return state;
}

export * from "@consentify/core";

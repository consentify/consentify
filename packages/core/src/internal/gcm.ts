import type { ConsentMode, ConsentifySubscribable } from './types';
import { logE } from './util';

export type GoogleConsentType =
  | 'ad_storage'
  | 'ad_user_data'
  | 'ad_personalization'
  | 'analytics_storage'
  | 'functionality_storage'
  | 'personalization_storage'
  | 'security_storage';

type GoogleConsentValue = 'granted' | 'denied';

export interface ConsentModeOptions<T extends string> {
  mapping: Partial<Record<'necessary' | T, GoogleConsentType[]>>;
  waitForUpdate?: number;
}

export const defaultConsentModeMapping = {
    necessary: ['security_storage'],
    analytics: ['analytics_storage'],
    marketing: ['ad_storage', 'ad_user_data', 'ad_personalization'],
    preferences: ['functionality_storage', 'personalization_storage'],
} as const satisfies Record<string, readonly GoogleConsentType[]>;

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

function safeGtag(...args: unknown[]): void {
    try {
        window.gtag(...args);
    } catch (err) {
        logE('gtag call failed:', err);
    }
}

export function enableConsentMode<T extends string>(
  instance: ConsentifySubscribable<T> & { mode?: ConsentMode },
  options: ConsentModeOptions<T>,
): () => void {
  if (typeof window === 'undefined') return () => {};

  window.dataLayer = window.dataLayer || [];

  if (typeof window.gtag !== 'function') {
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer.push(arguments);
    };
  }

  const resolve = (): Record<string, GoogleConsentValue> => {
    const state = instance.get();
    const result: Record<string, GoogleConsentValue> = {};

    for (const [category, gTypes] of Object.entries(options.mapping)) {
      if (!gTypes) continue;

      let granted = false;
      if (category === 'necessary') {
        granted = true;
      } else if (state.decision === 'decided') {
        granted = !!(state.snapshot.choices as Record<string, boolean>)[category];
      } else if (instance.mode === 'opt-out') {
        granted = true;
      }

      for (const gType of gTypes) {
        result[gType] = granted ? 'granted' : 'denied';
      }
    }

    return result;
  };

  const initial = resolve();
  const defaultPayload: Record<string, unknown> = options.waitForUpdate != null
    ? { ...initial, wait_for_update: options.waitForUpdate }
    : initial;
  safeGtag('consent', 'default', defaultPayload);

  if (instance.get().decision === 'decided') {
    safeGtag('consent', 'update', initial);
  }

  return instance.subscribe(() => {
    if (instance.get().decision === 'decided') {
      safeGtag('consent', 'update', resolve());
    }
  });
}

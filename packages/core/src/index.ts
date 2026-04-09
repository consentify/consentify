// --- Types (generic categories) ---
/**
 * Literal type for the non-optional category that is always enabled.
 */
export type Necessary = 'necessary';

/**
 * User-defined category identifier (e.g., 'analytics', 'marketing').
 */
export type UserCategory = string;

/**
 * Map of consent choices for all categories, including the 'necessary' category.
 * A value of `true` means the user granted consent for the category.
 */
export type Choices<T extends UserCategory> = Record<Necessary | T, boolean>;

/**
 * Describes a cookie policy and its consent categories.
 * @template T Category string union used by this policy.
 */
export interface Policy<T extends UserCategory> {
    /**
     * Optional stable identifier for your policy. Prefer supplying a value derived from
     * your actual policy content/version (e.g., a hash of the policy document).
     * If omitted, a deterministic hash of the provided categories (and this identifier when present)
     * will be used to key snapshots.
     */
    identifier?: string;
    categories: readonly T[];
}

/**
 * Immutable snapshot of a user's consent decision for a specific policy version.
 * @template T Category string union captured in the snapshot.
 */
export interface Snapshot<T extends UserCategory> {
    policy: string;
    givenAt: string;
    choices: Choices<T>;
}

/**
 * High-level consent state derived from the presence of a valid snapshot.
 * When no valid snapshot exists for the current policy version, the state is `unset`.
 */
export type ConsentState<T extends UserCategory> =
| {decision: 'unset'}
| {decision: 'decided', snapshot: Snapshot<T>}

// Utility to turn a readonly string[] into a string union
type ArrToUnion<T extends readonly string[]> = T[number];

// Storage kinds: keep only widely used options for SSR apps
export type StorageKind = 'cookie' | 'localStorage';

export interface CreateConsentifyInit<Cs extends readonly string[]> {
    policy: { categories: Cs, identifier?: string };
    cookie?: {
        name?: string; maxAgeSec?: number; sameSite?: 'Lax'|'Strict'|'None';
        secure?: boolean; path?: string; domain?: string;
    };
    /**
     * Maximum age of consent in days. If set, consent older than this
     * will be treated as expired, requiring re-consent.
     */
    consentMaxAgeDays?: number;
    /**
     * Client-side storage priority. Server-side access is cookie-only.
     * Supported: 'cookie' (canonical), 'localStorage' (optional mirror for fast reads)
     * Default: ['cookie']
     */
    storage?: StorageKind[];
}

/**
 * Minimal interface for subscribing to consent state changes.
 * Used by `enableConsentMode` and other adapters that need reactive consent state.
 */
export interface ConsentifySubscribable<T extends UserCategory> {
    subscribe: (callback: () => void) => () => void;
    get: () => ConsentState<T>;
    getServerSnapshot: () => ConsentState<T>;
}

// --- Typed event system ---
export interface ConsentEventMap<T extends UserCategory> {
    change: { from: ConsentState<T>; to: ConsentState<T>; timestamp: number };
    clear: { timestamp: number };
}

export type ConsentEventHandler<T extends UserCategory, K extends keyof ConsentEventMap<T>> =
    (event: ConsentEventMap<T>[K]) => void;

/** @internal */
export function stableStringify(o: unknown): string {
    if (o === null || typeof o !== 'object') return JSON.stringify(o);
    if (Array.isArray(o)) return `[${o.map(stableStringify).join(',')}]`;
    const e = Object.entries(o as Record<string, unknown>).sort((a, b) => a[0].localeCompare(b[0]));
    return `{${e.map(([k, v]) => JSON.stringify(k) + ':' + stableStringify(v)).join(',')}}`;
}

/** @internal */
export function fnv1a(str: string): string {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
}

/** @internal */
export function hashPolicy(categories: readonly string[], identifier?: string): string {
    // Deterministic identity for the policy. If you provide `identifier`, it is folded into the hash,
    // but consider using `identifier` itself as the canonical version key for clarity.
    return fnv1a(stableStringify({ categories: [...categories].sort(), identifier: identifier ?? null}));
}
// --- Internals ---
const DEFAULT_COOKIE = 'consentify';
const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o));
const dec = <T>(s: string) => { try { return JSON.parse(decodeURIComponent(s)) as T; } catch { return null; } };
const toISO = () => new Date().toISOString();

function isValidSnapshot<T extends UserCategory>(s: unknown): s is Snapshot<T> {
    if (
        typeof s !== 'object' || s === null ||
        typeof (s as any).policy !== 'string' || (s as any).policy === '' ||
        typeof (s as any).givenAt !== 'string' ||
        typeof (s as any).choices !== 'object' || (s as any).choices === null
    ) return false;
    // Validate givenAt is a valid ISO date
    if (isNaN(new Date((s as any).givenAt).getTime())) return false;
    // Validate all choice values are booleans
    for (const v of Object.values((s as any).choices)) {
        if (typeof v !== 'boolean') return false;
    }
    return true;
}

type CookieOpt = { maxAgeSec: number; sameSite: 'Lax'|'Strict'|'None'; secure: boolean; path: string; domain?: string };

function buildSetCookieHeader(name: string, value: string, opt: CookieOpt): string {
    let h = `${name}=${value}; Path=${opt.path}; Max-Age=${opt.maxAgeSec}; SameSite=${opt.sameSite}`;
    if (opt.domain) h += `; Domain=${opt.domain}`;
    if (opt.secure) h += `; Secure`;
    return h;
}

function readCookie(name: string, cookieStr?: string): string | null {
    const src = cookieStr ?? (typeof document !== 'undefined' ? document.cookie : '');
    if (!src) return null;
    const m = src.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='));
    return m ? m.slice(name.length + 1) : null;
}
function writeCookie(name: string, value: string, opt: CookieOpt): void {
    if (typeof document === 'undefined') return;
    document.cookie = buildSetCookieHeader(name, value, opt);
}

// --- Unified Factory (single entry point) ---
export function createConsentify<Cs extends readonly string[]>(init: CreateConsentifyInit<Cs>) {
    type T = ArrToUnion<Cs>;
    const policyHash = init.policy.identifier ?? hashPolicy(init.policy.categories);
    const cookieName = init.cookie?.name ?? DEFAULT_COOKIE;
    const sameSite = init.cookie?.sameSite ?? 'Lax';
    const cookieCfg = {
        path: init.cookie?.path ?? '/',
        maxAgeSec: init.cookie?.maxAgeSec ?? 60 * 60 * 24 * 365,
        sameSite,
        secure: sameSite === 'None' ? true : (init.cookie?.secure ?? true),
        domain: init.cookie?.domain,
    };
    const storageOrder: StorageKind[] = (init.storage && init.storage.length > 0) ? init.storage : ['cookie'];
    const consentMaxAgeDays = init.consentMaxAgeDays;

    const isExpired = (givenAt: string): boolean => {
        if (!consentMaxAgeDays) return false;
        const givenTime = new Date(givenAt).getTime();
        if (isNaN(givenTime)) return true; // Invalid date = expired
        const maxAgeMs = consentMaxAgeDays * 24 * 60 * 60 * 1000;
        return Date.now() - givenTime > maxAgeMs;
    };

    const allowed = new Set<Necessary | T>(['necessary', ...(init.policy.categories as unknown as T[])]);

    const normalize = (choices?: Partial<Choices<T>>): Choices<T> => {
        const base = { necessary: true } as Choices<T>;
        for (const c of init.policy.categories as unknown as T[]) (base as any)[c] = false;
        if (choices) {
            for (const [k,v] of Object.entries(choices) as [keyof Choices<T>, boolean][]) {
                if (allowed.has(k as any)) (base as any)[k] = !!v;
            }
        }
        (base as any).necessary = true;
        return base;
    };

    // --- client-side storage helpers ---
    const isBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined';
    const canLocal = () => { try { return isBrowser() && !!window.localStorage; } catch { return false; } };

    const readFromStore = (kind: StorageKind): string | null => {
        switch (kind) {
            case 'cookie': return readCookie(cookieName);
            case 'localStorage': try { return canLocal() ? window.localStorage.getItem(cookieName) : null; } catch (err) { console.warn('[consentify] localStorage read failed:', err); return null; }
            default: return null;
        }
    };
    const writeToStore = (kind: StorageKind, value: string) => {
        switch (kind) {
            case 'cookie': writeCookie(cookieName, value, cookieCfg); break;
            case 'localStorage': try { if (canLocal()) window.localStorage.setItem(cookieName, value); } catch (err) { console.warn('[consentify] localStorage write failed:', err); } break;
        }
    };
    const clearCookieHeader = () => buildSetCookieHeader(cookieName, '', { ...cookieCfg, maxAgeSec: 0 });
    const clearStore = (kind: StorageKind) => {
        switch (kind) {
            case 'cookie': if (isBrowser()) document.cookie = clearCookieHeader(); break;
            case 'localStorage': try { if (canLocal()) window.localStorage.removeItem(cookieName); } catch (err) { console.warn('[consentify] localStorage clear failed:', err); } break;
        }
    };
    const firstAvailableStore = (): StorageKind => {
        for (const k of storageOrder) {
            if (k === 'cookie') return 'cookie';
            if (k === 'localStorage' && canLocal()) return 'localStorage';
        }
        return 'cookie';
    };
    const readClientRaw = (): string | null => {
        for (const k of storageOrder) {
            const v = readFromStore(k);
            if (v) return v;
        }
        return null;
    };
    const writeClientRaw = (value: string) => {
        const primary = firstAvailableStore();
        writeToStore(primary, value);
        if (primary !== 'cookie' && storageOrder.includes('cookie')) writeToStore('cookie', value);
    };

    // --- read helpers ---
    const readClient = (): Snapshot<T> | null => {
        const raw = readClientRaw();
        const s = raw ? dec<Snapshot<T>>(raw) : null;
        if (!s || !isValidSnapshot<T>(s)) return null;
        if (s.policy !== policyHash) return null;
        if (isExpired(s.givenAt)) return null;
        return s;
    };

    const writeClientIfChanged = (next: Snapshot<T>): boolean => {
        const prev = readClient();
        const same = !!(prev && prev.policy === next.policy && JSON.stringify(prev.choices) === JSON.stringify(next.choices));
        if (!same) writeClientRaw(enc(next));
        return !same;
    };

    // ---- server API
    const server = {
        get: (cookieHeader: string | null | undefined): ConsentState<T> => {
            const raw = cookieHeader ? readCookie(cookieName, cookieHeader) : null;
            const s = raw ? dec<Snapshot<T>>(raw) : null;
            if (!s || !isValidSnapshot<T>(s)) return { decision: 'unset' };
            if (s.policy !== policyHash) return { decision: 'unset' };
            if (isExpired(s.givenAt)) return { decision: 'unset' };
            return { decision: 'decided', snapshot: s };
        },
        set: (
            choices: Partial<Choices<T>>,
            currentCookieHeader?: string
        ): string => {
            const prev = currentCookieHeader ? server.get(currentCookieHeader) : { decision: 'unset' as const };
            const base = prev.decision === 'decided' ? prev.snapshot.choices : normalize();
            const snapshot: Snapshot<T> = {
                policy: policyHash,
                givenAt: toISO(),
                choices: normalize({ ...base, ...choices }),
            };
            return buildSetCookieHeader(cookieName, enc(snapshot), cookieCfg);
        },
        clear: (): string => clearCookieHeader()
    };

    // ========== Subscribe pattern for React ==========
    const listeners = new Set<() => void>();
    const unsetState: ConsentState<T> = { decision: 'unset' };
    let cachedState: ConsentState<T> = unsetState;

    const syncState = (): void => {
        const s = readClient();
        if (!s) {
            cachedState = unsetState;
        } else {
            cachedState = { decision: 'decided', snapshot: s };
        }
    };

    const notifyListeners = (): void => {
        listeners.forEach(cb => {
            try { cb(); } catch (err) {
                console.error('[consentify] Listener callback threw:', err);
            }
        });
    };

    // Init cache on browser
    if (isBrowser()) {
        syncState();
    }

    // Multi-tab sync — notify other tabs on any consent change
    let bc: BroadcastChannel | null = null;
    if (isBrowser() && typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel(`consentify:${cookieName}`);
        bc.onmessage = () => { syncState(); notifyListeners(); };
    }
    // ======================================================

    // ---- Typed event emitter ----
    // Handlers are typed at the on()/emit() boundary; the Map stores the union since
    // TypeScript can't express per-key handler types in a single Map.
    const eventHandlers = new Map<string, Set<(event: any) => void>>();

    function emit<K extends keyof ConsentEventMap<T>>(type: K, event: ConsentEventMap<T>[K]) {
        const handlers = eventHandlers.get(type);
        if (!handlers) return;
        for (const h of handlers) {
            try { h(event); } catch (err) {
                console.error('[consentify] Event handler threw:', err);
            }
        }
    }

    function on<K extends keyof ConsentEventMap<T>>(
        type: K, handler: ConsentEventHandler<T, K>,
    ): () => void {
        if (!eventHandlers.has(type)) eventHandlers.set(type, new Set());
        eventHandlers.get(type)!.add(handler);
        return () => eventHandlers.get(type)!.delete(handler);
    }

    function once<K extends keyof ConsentEventMap<T>>(
        type: K, handler: ConsentEventHandler<T, K>,
    ): () => void {
        const unsub = on(type, (e) => { unsub(); handler(e); });
        return unsub;
    }

    // ---- client API
    function clientGet(): ConsentState<T>;
    function clientGet(category: Necessary | T): boolean;
    function clientGet(category?: Necessary | T): ConsentState<T> | boolean {
        // Return cached state for React compatibility
        if (typeof category === 'undefined') return cachedState;
        if (category === 'necessary') return true;
        return cachedState.decision === 'decided'
            ? !!cachedState.snapshot.choices[category]
            : false;
    }

    const client = {
        get: clientGet,

        set: (choices: Partial<Choices<T>>) => {
            const from = cachedState;
            const fresh = readClient();
            const base = fresh ? fresh.choices : normalize();
            const next: Snapshot<T> = {
                policy: policyHash,
                givenAt: toISO(),
                choices: normalize({ ...base, ...choices }),
            };
            const changed = writeClientIfChanged(next);
            if (changed) {
                syncState();
                notifyListeners();
                emit('change', { from, to: cachedState, timestamp: Date.now() });
                bc?.postMessage(null);
            }
        },

        clear: () => {
            const hadConsent = cachedState.decision === 'decided';
            for (const k of new Set<StorageKind>([...storageOrder, 'cookie'])) clearStore(k);
            syncState();
            if (hadConsent) {
                notifyListeners();
                emit('clear', { timestamp: Date.now() });
                bc?.postMessage(null);
            }
        },

        subscribe: (callback: () => void): (() => void) => {
            listeners.add(callback);
            return () => listeners.delete(callback);
        },

        getServerSnapshot: (): ConsentState<T> => unsetState,

        guard: (
            category: Necessary | T,
            onGrant: () => void,
            onRevoke?: () => void,
        ): (() => void) => {
            let phase: 'waiting' | 'granted' | 'done' = 'waiting';
            const check = () => clientGet(category as Necessary | T) === true;

            const tick = () => {
                if (phase === 'waiting' && check()) {
                    onGrant();
                    phase = onRevoke ? 'granted' : 'done';
                    if (phase === 'done') unsub();
                } else if (phase === 'granted' && !check()) {
                    onRevoke!();
                    phase = 'done';
                    unsub();
                }
            };

            const unsub = client.subscribe(tick);
            tick();

            return () => { phase = 'done'; unsub(); };
        },
    };

    // --- Flat top-level API (overloaded for precise return types) ---
    function flatGet(): ConsentState<T>;
    function flatGet(cookieHeader: string): ConsentState<T>;
    function flatGet(cookieHeader: null): ConsentState<T>;
    function flatGet(cookieHeader?: string | null): ConsentState<T> {
        return typeof cookieHeader === 'string'
            ? server.get(cookieHeader)
            : client.get();
    }

    function flatSet(choices: Partial<Choices<T>>): void;
    function flatSet(choices: Partial<Choices<T>>, cookieHeader: string): string;
    function flatSet(choices: Partial<Choices<T>>, cookieHeader?: string): string | void {
        if (typeof cookieHeader === 'string') return server.set(choices, cookieHeader);
        client.set(choices);
    }

    function flatClear(): void;
    function flatClear(serverMode: string): string;
    function flatClear(serverMode?: string): string | void {
        if (typeof serverMode === 'string') return server.clear();
        client.clear();
    }

    return {
        policy: {
            categories: init.policy.categories,
            identifier: policyHash,
        },
        server,
        client,

        get: flatGet,
        isGranted: (category: Necessary | T): boolean => {
            return clientGet(category as Necessary | T);
        },
        set: flatSet,
        clear: flatClear,
        subscribe: client.subscribe,
        getServerSnapshot: client.getServerSnapshot,
        guard: client.guard,
        on,
        once,
    } as const;
}

// Common predefined category names you can reuse in your policy.
export const defaultCategories = ['preferences','analytics','marketing','functional','unclassified'] as const;
export type DefaultCategory = typeof defaultCategories[number];

// --- Debug adapter ---
export interface EnableDebugOptions<T extends UserCategory = UserCategory> {
    onLog?: (message: string, event: ConsentEventMap<T>[keyof ConsentEventMap<T>]) => void;
}

export function enableDebug<T extends UserCategory>(
    instance: { on: <K extends keyof ConsentEventMap<T>>(type: K, handler: ConsentEventHandler<T, K>) => () => void },
    options?: EnableDebugOptions<T>,
): () => void {
    const log = options?.onLog ?? ((msg: string, event: unknown) => console.log(`[consentify] ${msg}`, event));
    const unsub1 = instance.on('change', (e) => log('Consent changed', e));
    const unsub2 = instance.on('clear', (e) => log('Consent cleared', e));
    return () => { unsub1(); unsub2(); };
}

// --- Google Consent Mode v2 ---

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
        console.error('[consentify] gtag call failed:', err);
    }
}

export function enableConsentMode<T extends string>(
  instance: ConsentifySubscribable<T>,
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

    for (const [category, gTypes] of Object.entries(options.mapping) as [string, GoogleConsentType[]][]) {
      if (!gTypes) continue;

      let granted = false;
      if (category === 'necessary') {
        granted = true;
      } else if (state.decision === 'decided') {
        granted = !!(state.snapshot.choices as Record<string, boolean>)[category];
      }

      for (const gType of gTypes) {
        result[gType] = granted ? 'granted' : 'denied';
      }
    }

    return result;
  };

  const defaultPayload: Record<string, unknown> = { ...resolve() };
  if (options.waitForUpdate != null) {
    defaultPayload.wait_for_update = options.waitForUpdate;
  }
  safeGtag('consent', 'default', defaultPayload);

  const state = instance.get();
  if (state.decision === 'decided') {
    safeGtag('consent', 'update', resolve());
  }

  const unsubscribe = instance.subscribe(() => {
    const current = instance.get();
    if (current.decision === 'decided') {
      safeGtag('consent', 'update', resolve());
    }
  });

  return unsubscribe;
}

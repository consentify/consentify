// Public API composition for @consentify/core.
//
// This file intentionally delegates implementation details to internal
// modules under ./internal/ so the top-level entry stays focused on the
// public shape, the `createConsentify` factory, and re-exports. Tree-shaking
// continues to work because every package we split into is side-effect free
// (see `sideEffects: false` in package.json).

import type {
    ArrToUnion,
    Choices,
    ConsentAdapter,
    ConsentEventHandler,
    ConsentEventMap,
    ConsentMode,
    ConsentProof,
    ConsentState,
    Necessary,
    Snapshot,
    StorageKind,
    VisitorIdSource,
} from './internal/types';
import { ConsentifyConfigError } from './internal/types';
import {
    DEFAULT_COOKIE,
    buildSetCookieHeader,
    readCookie,
    writeCookie,
    type CookieOpt,
} from './internal/cookie';
import { buildProofFnv1a, buildProofHmac } from './internal/crypto';
import { resolveVisitorId } from './internal/visitor';
import {
    DEFAULT_CONFIG_ENDPOINT,
    DEFAULT_INGEST_ENDPOINT,
    fetchSiteConfig,
    startCloudReporting,
} from './internal/cloud';
import {
    MS_PER_DAY,
    TAG,
    canLocalStorage,
    dec,
    enc,
    hashPolicy,
    isBrowser,
    isValidSnapshot,
    logE,
    logW,
    toISO,
} from './internal/util';

// --- Public types re-exports ------------------------------------------------

export type {
    Choices,
    ConsentAdapter,
    ConsentEventHandler,
    ConsentEventMap,
    ConsentMode,
    ConsentProof,
    ConsentState,
    Necessary,
    Snapshot,
    StorageKind,
    UserCategory,
    VisitorIdSource,
} from './internal/types';
export type { Policy, ConsentifySubscribable } from './internal/types';
export { ConsentifyConfigError } from './internal/types';

// Re-export the side feature modules.
export { verifyProof } from './internal/crypto';
export { stableStringify, fnv1a, hashPolicy } from './internal/util';
export {
    enableConsentMode,
    defaultConsentModeMapping,
    type GoogleConsentType,
    type ConsentModeOptions,
} from './internal/gcm';
export { enableDebug, type EnableDebugOptions } from './internal/debug';

// --- Factory init types -----------------------------------------------------

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
     * Consent mode. 'opt-in' (default, GDPR) treats categories as denied until
     * the user explicitly consents. 'opt-out' (CCPA) treats categories as granted
     * until the user explicitly opts out.
     */
    mode?: ConsentMode;
    /**
     * Days before consent expiration to emit the 'expiring' event.
     * Only relevant when consentMaxAgeDays is set. Default: 30.
     */
    expirationWarningDays?: number;
    /**
     * Client-side storage priority. Server-side access is cookie-only.
     * Supported: 'cookie' (canonical), 'localStorage' (optional mirror for fast reads)
     * Default: ['cookie']
     */
    storage?: StorageKind[];
    /**
     * HMAC-SHA256 signing secret for consent proofs. Server-only — passing this
     * value in a browser context throws ConsentifyConfigError because the secret
     * would be visible to end users. When set, `getProof()` returns a Promise.
     * When omitted, a non-cryptographic FNV1a signature is used (deprecated).
     */
    secret?: string;
    /**
     * Optional custom storage backend (e.g. a server-side database). When
     * provided, the SDK mirrors every consent change to `adapter.save()` and
     * hydrates initial state from `adapter.load()` on browser init.
     */
    adapter?: ConsentAdapter<ArrToUnion<Cs>>;
    /**
     * Visitor identifier used by the adapter and cloud reporter. When omitted,
     * a per-browser id is generated and persisted in localStorage under
     * `consentify_visitor`. On the server this falls back to an empty string
     * unless explicitly provided.
     */
    visitorId?: VisitorIdSource;
}

/**
 * Init variant for SaaS / cloud mode. When `siteId` is present, the factory
 * becomes async: it fetches a SiteConfig from the CDN, derives `policy` and
 * `mode` from it, and auto-enables cloud event reporting to the ingest
 * endpoint. Local overrides take precedence over values from the fetched
 * SiteConfig.
 */
export interface CloudInit {
    siteId: string;
    apiKey?: string;
    endpoints?: { config?: string; ingest?: string };
    cookie?: CreateConsentifyInit<readonly string[]>['cookie'];
    mode?: ConsentMode;
    consentMaxAgeDays?: number;
    expirationWarningDays?: number;
    storage?: StorageKind[];
    secret?: string;
    /**
     * Custom storage backend. In cloud mode the category union is only known
     * after the SiteConfig fetch, so adapters here use the default string
     * union. Narrow by writing `ConsentAdapter<'analytics' | 'marketing'>`
     * explicitly if you want a tighter type.
     */
    adapter?: ConsentAdapter;
    visitorId?: VisitorIdSource;
}

// --- Public instance shapes -------------------------------------------------

/**
 * Members shared by both sync (FNV1a) and async (HMAC) instance variants.
 * Only `getProof` differs between them.
 */
interface ConsentifyInstanceShared<Cs extends readonly string[]> {
    readonly policy: { readonly categories: Cs; readonly identifier: string };
    readonly mode: ConsentMode;
    readonly server: {
        get: (cookieHeader: string | null | undefined) => ConsentState<ArrToUnion<Cs>>;
        set: (choices: Partial<Choices<ArrToUnion<Cs>>>, currentCookieHeader?: string) => string;
        clear: () => string;
    };
    readonly client: {
        get: {
            (): ConsentState<ArrToUnion<Cs>>;
            /** @deprecated Use `isGranted(category)` or `consent.client` pattern with `get()` + manual check. Slated for removal in v3. */
            (category: Necessary | ArrToUnion<Cs>): boolean;
        };
        set: (choices: Partial<Choices<ArrToUnion<Cs>>>) => void;
        clear: () => void;
        subscribe: (callback: () => void) => () => void;
        getServerSnapshot: () => ConsentState<ArrToUnion<Cs>>;
        guard: (
            category: Necessary | ArrToUnion<Cs>,
            onGrant: () => void,
            onRevoke?: () => void,
        ) => () => void;
    };
    readonly get: {
        (): ConsentState<ArrToUnion<Cs>>;
        (cookieHeader: string): ConsentState<ArrToUnion<Cs>>;
        (cookieHeader: null): ConsentState<ArrToUnion<Cs>>;
    };
    readonly isGranted: (category: Necessary | ArrToUnion<Cs>) => boolean;
    readonly set: {
        (choices: Partial<Choices<ArrToUnion<Cs>>>): void;
        (choices: Partial<Choices<ArrToUnion<Cs>>>, cookieHeader: string): string;
    };
    readonly clear: {
        (): void;
        (cookieHeader: string): string;
    };
    readonly acceptAll: {
        (): void;
        (cookieHeader: string): string;
    };
    readonly rejectAll: {
        (): void;
        (cookieHeader: string): string;
    };
    readonly subscribe: (callback: () => void) => () => void;
    readonly getServerSnapshot: () => ConsentState<ArrToUnion<Cs>>;
    readonly guard: (
        category: Necessary | ArrToUnion<Cs>,
        onGrant: () => void,
        onRevoke?: () => void,
    ) => () => void;
    readonly on: <K extends keyof ConsentEventMap<ArrToUnion<Cs>>>(
        type: K,
        handler: ConsentEventHandler<ArrToUnion<Cs>, K>,
    ) => () => void;
    readonly once: <K extends keyof ConsentEventMap<ArrToUnion<Cs>>>(
        type: K,
        handler: ConsentEventHandler<ArrToUnion<Cs>, K>,
    ) => () => void;
    /**
     * Release the BroadcastChannel and clear all listeners and event handlers.
     * The instance remains readable but no longer reactive. Safe to call multiple times.
     * Useful for tests, HMR, and micro-frontends.
     */
    readonly destroy: () => void;
}

/**
 * Instance returned by `createConsentify` when `secret` is absent (the
 * default). `getProof()` is synchronous and uses the FNV1a fallback signature.
 *
 * @remarks The FNV1a fallback is **deprecated** because its signature is not
 * cryptographically secure and can be forged. For real audit trails, pass a
 * server-side `secret` to `createConsentify` — this returns a
 * {@link ConsentifyAsyncInstance} whose `getProof()` is HMAC-SHA256 signed.
 * A one-time runtime warning is emitted the first time `getProof()` is called
 * on an instance without a `secret`.
 */
export interface ConsentifyInstance<Cs extends readonly string[]>
    extends ConsentifyInstanceShared<Cs> {
    readonly getProof: {
        /** @deprecated Unsigned FNV1a proof is forgeable. Pass `secret` to createConsentify for HMAC-SHA256 signing. */
        (): ConsentProof<ArrToUnion<Cs>> | null;
        /** @deprecated Unsigned FNV1a proof is forgeable. Pass `secret` to createConsentify for HMAC-SHA256 signing. */
        (cookieHeader: string): ConsentProof<ArrToUnion<Cs>> | null;
    };
}

/**
 * Instance returned by `createConsentify` when `secret` is provided. All
 * proof-related methods are async (HMAC-SHA256).
 */
export interface ConsentifyAsyncInstance<Cs extends readonly string[]>
    extends ConsentifyInstanceShared<Cs> {
    readonly getProof: {
        (): Promise<ConsentProof<ArrToUnion<Cs>> | null>;
        (cookieHeader: string): Promise<ConsentProof<ArrToUnion<Cs>> | null>;
    };
}

// --- Unified Factory (single entry point) -----------------------------------
/**
 * Self-hosted mode with HMAC-SHA256 proofs: `secret` is set. Returns an
 * instance whose `getProof()` is async. Server-only — passing `secret` in a
 * browser context throws `ConsentifyConfigError`.
 */
export function createConsentify<Cs extends readonly string[]>(
    init: CreateConsentifyInit<Cs> & { secret: string; siteId?: never },
): ConsentifyAsyncInstance<Cs>;
/**
 * Self-hosted mode (default): synchronous factory. `getProof()` uses the
 * deprecated FNV1a fallback.
 */
export function createConsentify<Cs extends readonly string[]>(
    init: CreateConsentifyInit<Cs> & { siteId?: never },
): ConsentifyInstance<Cs>;
/**
 * Cloud / SaaS mode with HMAC-SHA256 proofs: `secret` is set. Server-only.
 * Returns an async instance whose `getProof()` is HMAC-signed.
 */
export function createConsentify(
    init: CloudInit & { policy?: never; secret: string },
): Promise<ConsentifyAsyncInstance<readonly string[]>>;
/**
 * Cloud / SaaS mode: async factory that fetches SiteConfig from the CDN and
 * auto-enables event reporting to the ingest endpoint.
 */
export function createConsentify(
    init: CloudInit & { policy?: never },
): Promise<ConsentifyInstance<readonly string[]>>;
export function createConsentify(
    init: CreateConsentifyInit<readonly string[]> | CloudInit,
): ConsentifyInstance<readonly string[]>
   | ConsentifyAsyncInstance<readonly string[]>
   | Promise<ConsentifyInstance<readonly string[]> | ConsentifyAsyncInstance<readonly string[]>> {
    if ('siteId' in init && typeof (init as CloudInit).siteId === 'string') {
        return createCloudInstance(init as CloudInit);
    }
    return createSelfHostedInstance(init as CreateConsentifyInit<readonly string[]>);
}

async function createCloudInstance(
    init: CloudInit,
): Promise<ConsentifyInstance<readonly string[]> | ConsentifyAsyncInstance<readonly string[]>> {
    const configEndpoint = init.endpoints?.config ?? DEFAULT_CONFIG_ENDPOINT;
    const ingestEndpoint = init.endpoints?.ingest ?? DEFAULT_INGEST_ENDPOINT;
    const siteCfg = await fetchSiteConfig(init.siteId, configEndpoint);
    const merged: CreateConsentifyInit<readonly string[]> = {
        policy: {
            categories: siteCfg.categories,
            identifier: siteCfg.policyIdentifier,
        },
        cookie: init.cookie,
        mode: init.mode ?? siteCfg.mode,
        consentMaxAgeDays: init.consentMaxAgeDays ?? siteCfg.consentMaxAgeDays,
        expirationWarningDays: init.expirationWarningDays,
        storage: init.storage,
        secret: init.secret,
        adapter: init.adapter,
        visitorId: init.visitorId,
    };
    const instance = createSelfHostedInstance(merged);
    if (isBrowser()) {
        startCloudReporting(instance, {
            siteId: init.siteId,
            apiKey: init.apiKey,
            ingestEndpoint,
        });
    }
    return instance;
}

function createSelfHostedInstance<Cs extends readonly string[]>(
    init: CreateConsentifyInit<Cs>,
): ConsentifyInstance<Cs> | ConsentifyAsyncInstance<Cs> {
    type T = ArrToUnion<Cs>;
    if (init.secret && isBrowser()) {
        throw new ConsentifyConfigError(TAG + '`secret` is server-only');
    }
    const policyHash = init.policy.identifier ?? hashPolicy(init.policy.categories);
    const cookieName = init.cookie?.name ?? DEFAULT_COOKIE;
    const sameSite = init.cookie?.sameSite ?? 'Lax';
    const cookieCfg: CookieOpt = {
        path: init.cookie?.path ?? '/',
        maxAgeSec: init.cookie?.maxAgeSec ?? 60 * 60 * 24 * 365,
        sameSite,
        secure: sameSite === 'None' ? true : (init.cookie?.secure ?? true),
        domain: init.cookie?.domain,
    };
    const storageOrder: StorageKind[] = (init.storage && init.storage.length > 0) ? init.storage : ['cookie'];
    const consentMaxAgeDays = init.consentMaxAgeDays;
    const mode: ConsentMode = init.mode ?? 'opt-in';
    const expirationWarningDays = init.expirationWarningDays ?? 30;
    if (consentMaxAgeDays && expirationWarningDays >= consentMaxAgeDays) {
        logW('expirationWarningDays >= consentMaxAgeDays');
    }

    const isExpired = (givenAt: string): boolean => {
        if (!consentMaxAgeDays) return false;
        const givenTime = Date.parse(givenAt);
        return Number.isNaN(givenTime) || Date.now() - givenTime > consentMaxAgeDays * MS_PER_DAY;
    };

    const allowed = new Set<Necessary | T>(['necessary', ...(init.policy.categories as unknown as T[])]);

    const normalize = (choices?: Partial<Choices<T>>): Choices<T> => {
        const base: Record<string, boolean> = {};
        for (const c of init.policy.categories) base[c] = false;
        if (choices) {
            for (const k in choices) {
                if (allowed.has(k as Necessary | T)) base[k] = !!choices[k as keyof Choices<T>];
            }
        }
        base.necessary = true;
        return base as Choices<T>;
    };

    const allChoices = (grant: boolean): Partial<Choices<T>> => {
        const c: Record<string, boolean> = {};
        for (const cat of init.policy.categories) c[cat] = grant;
        return c as Partial<Choices<T>>;
    };

    const secret = init.secret ?? '';

    // --- client-side storage helpers ---
    // Unified localStorage dispatcher: op is 'r'ead / 'w'rite / 'c'lear.
    // Collapses three try/catch blocks and three log messages into one.
    const ls = (op: 'r' | 'w' | 'c', value?: string): string | null => {
        if (!canLocalStorage()) return null;
        try {
            const s = window.localStorage;
            if (op === 'r') return s.getItem(cookieName);
            if (op === 'w') s.setItem(cookieName, value!);
            else s.removeItem(cookieName);
        } catch (err) { logW('localStorage failed:', err); }
        return null;
    };
    const readFromStore = (kind: StorageKind): string | null =>
        kind === 'cookie' ? readCookie(cookieName) : kind === 'localStorage' ? ls('r') : null;
    const writeToStore = (kind: StorageKind, value: string): void => {
        if (kind === 'cookie') writeCookie(cookieName, value, cookieCfg);
        else if (kind === 'localStorage') ls('w', value);
    };
    const clearStore = (kind: StorageKind): void => {
        if (kind === 'cookie') { if (isBrowser()) document.cookie = buildSetCookieHeader(cookieName, '', { ...cookieCfg, maxAgeSec: 0 }); }
        else if (kind === 'localStorage') ls('c');
    };
    const warnIfOversized = (value: string): void => {
        if (value.length > 3500) logW('consent cookie exceeds 3.5KB; browsers cap at 4KB');
    };

    const writeClientRaw = (value: string): void => {
        warnIfOversized(value);
        let primary: StorageKind = 'cookie';
        for (const k of storageOrder) {
            if (k === 'cookie' || (k === 'localStorage' && canLocalStorage())) { primary = k; break; }
        }
        writeToStore(primary, value);
        if (primary !== 'cookie' && storageOrder.includes('cookie')) writeToStore('cookie', value);
    };

    // --- read helpers ---
    const readClient = (): Snapshot<T> | null => {
        let raw: string | null = null;
        for (const k of storageOrder) {
            raw = readFromStore(k);
            if (raw) break;
        }
        const s = raw ? dec<Snapshot<T>>(raw) : null;
        if (!s || !isValidSnapshot<T>(s) || s.policy !== policyHash || isExpired(s.givenAt)) return null;
        return s;
    };

    // `prev` is passed in instead of re-read — the caller has already decoded
    // it once on the write path, and `readClient()` is non-trivial
    // (decodeURIComponent + JSON.parse + isValidSnapshot). `prev.policy` is
    // guaranteed to equal `next.policy` (both equal `policyHash`), so only
    // compare choices.
    const writeClientIfChanged = (prev: Snapshot<T> | null, next: Snapshot<T>): boolean => {
        const same = !!(prev && JSON.stringify(prev.choices) === JSON.stringify(next.choices));
        if (!same) writeClientRaw(enc(next));
        return !same;
    };

    // ---- server API
    const server = {
        get: (cookieHeader: string | null | undefined): ConsentState<T> => {
            const raw = cookieHeader ? readCookie(cookieName, cookieHeader) : null;
            const s = raw ? dec<Snapshot<T>>(raw) : null;
            if (!s || !isValidSnapshot<T>(s) || s.policy !== policyHash || isExpired(s.givenAt)) return { decision: 'unset' };
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
            const encoded = enc(snapshot);
            warnIfOversized(encoded);
            return buildSetCookieHeader(cookieName, encoded, cookieCfg);
        },
        clear: (): string => buildSetCookieHeader(cookieName, '', { ...cookieCfg, maxAgeSec: 0 })
    };

    // ========== Subscribe pattern for React ==========
    const listeners = new Set<() => void>();
    const unsetState: ConsentState<T> = { decision: 'unset' };
    let cachedState: ConsentState<T> = unsetState;

    const syncState = (): void => {
        const s = readClient();
        cachedState = s ? { decision: 'decided', snapshot: s } : unsetState;
    };

    // Fast path used by `client.set`: we already have the persisted snapshot
    // in hand, no need to re-read from storage.
    const setCachedSnapshot = (snapshot: Snapshot<T>): void => {
        cachedState = { decision: 'decided', snapshot };
    };

    const notifyListeners = (): void => {
        listeners.forEach(cb => {
            try { cb(); } catch (err) {
                logE('Listener callback threw:', err);
            }
        });
    };

    // ---- Typed event emitter ----
    // Handlers are typed at the on()/emit() boundary; the Map stores the union since
    // TypeScript can't express per-key handler types in a single Map.
    // biome-ignore lint/suspicious/noExplicitAny: see above — the Map erases per-key handler types
    const eventHandlers = new Map<string, Set<(event: any) => void>>();

    function emit<K extends keyof ConsentEventMap<T>>(type: K, event: ConsentEventMap<T>[K]) {
        const handlers = eventHandlers.get(type);
        if (!handlers) return;
        for (const h of handlers) {
            try { h(event); } catch (err) {
                logE('Event handler threw:', err);
            }
        }
    }

    function on<K extends keyof ConsentEventMap<T>>(
        type: K, handler: ConsentEventHandler<T, K>,
    ): () => void {
        let set = eventHandlers.get(type);
        if (!set) { set = new Set(); eventHandlers.set(type, set); }
        set.add(handler);
        return () => { set.delete(handler); };
    }

    function once<K extends keyof ConsentEventMap<T>>(
        type: K, handler: ConsentEventHandler<T, K>,
    ): () => void {
        const unsub = on(type, (e) => { unsub(); handler(e); });
        return unsub;
    }

    // --- Expiration warning ---
    let expiringEmittedForGivenAt = '';

    const checkExpiring = (): void => {
        if (!consentMaxAgeDays || cachedState.decision !== 'decided') return;
        const { givenAt } = cachedState.snapshot;
        if (givenAt === expiringEmittedForGivenAt) return;
        // `givenAt` is validated upstream (isValidSnapshot uses Date.parse).
        const expiresMs = Date.parse(givenAt) + consentMaxAgeDays * MS_PER_DAY;
        const daysRemaining = (expiresMs - Date.now()) / MS_PER_DAY;
        if (daysRemaining > 0 && daysRemaining <= expirationWarningDays) {
            expiringEmittedForGivenAt = givenAt;
            emit('expiring', { expiresAt: expiresMs, daysRemaining, timestamp: Date.now() });
        }
    };

    // Init cache on browser
    if (isBrowser()) {
        syncState();
        checkExpiring();
    }

    // Multi-tab sync — notify other tabs on any consent change
    let bc: BroadcastChannel | null = null;
    if (isBrowser() && typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel(`consentify:${cookieName}`);
        // Per-listener errors are already caught inside `notifyListeners`; other
        // helpers here (`syncState`, `checkExpiring`) only read validated state.
        // Events mirror local semantics: a write in another tab emits 'change',
        // a clear emits 'clear'. Deep-compare is fine here — messages are rare
        // and only sent on real changes.
        bc.onmessage = () => {
            const from = cachedState;
            syncState();
            const to = cachedState;
            notifyListeners();
            if (JSON.stringify(from) !== JSON.stringify(to)) {
                if (to.decision === 'decided') emit('change', { from, to, timestamp: Date.now() });
                else emit('clear', { timestamp: Date.now() });
            }
            checkExpiring();
        };
    }

    const destroy = (): void => {
        if (bc) {
            bc.close();
            bc = null;
        }
        listeners.clear();
        eventHandlers.clear();
    };
    // ======================================================

    // ---- Adapter + visitor id ----
    // Visitor id is resolved lazily and cached. Adapter `save`/`load` are
    // fire-and-forget: failures are logged but never bubble up into the
    // consent flow or throw from `client.set`.
    const adapter = init.adapter;
    let visitorIdPromise: Promise<string> | null = null;
    const getVisitorId = (): Promise<string> => {
        if (!visitorIdPromise) {
            visitorIdPromise = resolveVisitorId(init.visitorId).catch(err => {
                logW('visitorId failed:', err);
                visitorIdPromise = null;
                return '';
            });
        }
        return visitorIdPromise;
    };

    const runAdapterSave = (snapshot: Snapshot<T>): void => {
        if (!adapter) return;
        void (async () => {
            try {
                const visitorId = await getVisitorId();
                const proof = secret
                    ? await buildProofHmac(snapshot, secret)
                    : buildProofFnv1a(snapshot);
                await adapter.save({ visitorId, snapshot, proof });
            } catch (err) {
                logW('adapter.save failed:', err);
            }
        })();
    };


    // Hydrate from adapter on init (browser only, background, local wins on conflict).
    if (adapter && isBrowser()) {
        void (async () => {
            try {
                const visitorId = await getVisitorId();
                const remote = await adapter.load(visitorId);
                if (!remote || !isValidSnapshot<T>(remote)) return;
                if (remote.policy !== policyHash) return;
                if (isExpired(remote.givenAt)) return;
                if (readClient()) return;
                const from = cachedState;
                writeClientRaw(enc(remote));
                syncState();
                notifyListeners();
                emit('change', { from, to: cachedState, timestamp: Date.now() });
                checkExpiring();
                bc?.postMessage(null);
            } catch (err) {
                logW('adapter.load failed:', err);
            }
        })();
    }

    // ---- client API
    function clientGet(): ConsentState<T>;
    function clientGet(category: Necessary | T): boolean;
    function clientGet(category?: Necessary | T): ConsentState<T> | boolean {
        if (typeof category === 'undefined') return cachedState;
        if (category === 'necessary') return true;
        if (cachedState.decision === 'decided') return !!cachedState.snapshot.choices[category];
        return mode === 'opt-out';
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
            if (writeClientIfChanged(fresh, next)) {
                setCachedSnapshot(next);
                notifyListeners();
                emit('change', { from, to: cachedState, timestamp: Date.now() });
                checkExpiring();
                bc?.postMessage(null);
                runAdapterSave(next);
            }
        },

        clear: () => {
            const hadConsent = cachedState.decision === 'decided';
            for (const k of new Set<StorageKind>([...storageOrder, 'cookie'])) clearStore(k);
            syncState();
            expiringEmittedForGivenAt = '';
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
            const check = () => clientGet(category) === true;

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

    function flatBulkSet(grant: boolean, cookieHeader?: string): string | void {
        if (typeof cookieHeader === 'string') return server.set(allChoices(grant), cookieHeader);
        client.set(allChoices(grant));
    }

    function flatAcceptAll(): void;
    function flatAcceptAll(cookieHeader: string): string;
    function flatAcceptAll(cookieHeader?: string): string | void { return flatBulkSet(true, cookieHeader); }

    function flatRejectAll(): void;
    function flatRejectAll(cookieHeader: string): string;
    function flatRejectAll(cookieHeader?: string): string | void { return flatBulkSet(false, cookieHeader); }

    type ProofResult = ConsentProof<T> | null;
    let unsignedProofWarned = false;
    function flatGetProof(cookieHeader?: string): ProofResult | Promise<ProofResult> {
        const state = typeof cookieHeader === 'string' ? server.get(cookieHeader) : cachedState;
        if (state.decision !== 'decided') return secret ? Promise.resolve(null) : null;
        if (!secret && !unsignedProofWarned) {
            unsignedProofWarned = true;
            logW('getProof uses FNV1a fallback; pass `secret` for HMAC-SHA256');
        }
        return secret ? buildProofHmac(state.snapshot, secret) : buildProofFnv1a(state.snapshot);
    }

    const instance = {
        policy: {
            categories: init.policy.categories,
            identifier: policyHash,
        },
        mode,
        server,
        client,

        get: flatGet,
        isGranted: (category: Necessary | T): boolean => clientGet(category),
        set: flatSet,
        clear: flatClear,
        acceptAll: flatAcceptAll,
        rejectAll: flatRejectAll,
        getProof: flatGetProof,
        subscribe: client.subscribe,
        getServerSnapshot: client.getServerSnapshot,
        guard: client.guard,
        on,
        once,
        destroy,
    };
    return instance as unknown as ConsentifyInstance<Cs> | ConsentifyAsyncInstance<Cs>;
}

// Common predefined category names you can reuse in your policy.
export const defaultCategories = ['preferences','analytics','marketing','functional','unclassified'] as const;
export type DefaultCategory = typeof defaultCategories[number];

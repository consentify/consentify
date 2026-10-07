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
    ServerOptions,
    Snapshot,
    StorageKind,
    VisitorIdSource,
    WriteOptions,
} from './internal/types';
import { ConsentifyConfigError } from './internal/types';
import {
    DEFAULT_COOKIE,
    buildSetCookieHeader,
    readCookie,
    writeCookie,
    type CookieOpt,
} from './internal/cookie';
import { buildProofHmac } from './internal/crypto';
import { resolveVisitorId } from './internal/visitor';
import {
    MS_PER_DAY,
    SOURCES,
    TAG,
    canLocalStorage,
    dec,
    enc,
    hashPolicy,
    isBrowser,
    isValidSnapshot,
    logE,
    logW,
    randomHex,
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
    ConsentSource,
    ConsentState,
    Necessary,
    ServerOptions,
    Snapshot,
    StorageKind,
    UserCategory,
    VisitorIdSource,
    WriteOptions,
} from './internal/types';
export type { Policy, ConsentifySubscribable } from './internal/types';
export { ConsentifyConfigError } from './internal/types';

// Re-export the side feature modules.
export { verifyProof } from './internal/crypto';
export { stableStringify, fnv1a, hashPolicy } from './internal/util';
export { parseSetCookie } from './internal/cookie';
export {
    enableConsentMode,
    defaultConsentModeMapping,
    type GoogleConsentType,
    type ConsentModeOptions,
} from './internal/gcm';
export { enableDebug, type EnableDebugOptions } from './internal/debug';

// --- Factory init types -----------------------------------------------------

export interface CreateConsentifyInit<Cs extends readonly string[]> {
    policy: {
        categories: Cs;
        identifier?: string;
        /**
         * Version of the policy text shown to the user, recorded as `pv` on
         * every new consent record. Does not invalidate existing consent;
         * change `identifier` for material changes.
         */
        textVersion?: string;
    };
    /**
     * Language of the consent UI, recorded as `lang` on every new consent
     * record. In the browser it defaults to `<html lang>` (read at write
     * time); a per-call `lang` overrides both.
     */
    lang?: string;
    cookie?: {
        name?: string; sameSite?: 'Lax'|'Strict'|'None';
        secure?: boolean; path?: string; domain?: string;
        /** Cookie Max-Age in seconds. Default: `consentMaxAgeDays * 86400` when that is set, otherwise one year. */
        maxAgeSec?: number;
        /** Adds the CHIPS `Partitioned` attribute (forces `Secure`). For embedded / third-party iframe contexts. */
        partitioned?: boolean;
    };
    /**
     * Maximum age of consent in days. If set, consent older than this
     * will be treated as expired, requiring re-consent. Also sets the cookie
     * Max-Age unless `cookie.maxAgeSec` is given.
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
     * would be visible to end users. When set, the instance gets an async
     * `getProof()` and `adapter.save()` receives a `proof`. Without it there is
     * no proof API.
     */
    secret?: string;
    /**
     * Optional custom storage backend (e.g. a server-side database). When
     * provided, the SDK mirrors every consent change to `adapter.save()` and
     * hydrates initial state from `adapter.load()` on browser init.
     */
    adapter?: ConsentAdapter<ArrToUnion<Cs>>;
    /**
     * Visitor identifier used by the adapter and cloud reporter. When set (a
     * string or a sync/async factory) it is always used, also for `reject_all`
     * events. When omitted, a random id is stored in localStorage under
     * `consentify_visitor`, but only after a decision: hydration on load only
     * reads an existing id (and skips `adapter.load()` when there is none),
     * `adapter.save()` and accept/customize cloud events create it, and a
     * cloud `reject_all` deletes it and reports a one-off token instead. On
     * the server this falls back to an empty string unless explicitly provided.
     */
    visitorId?: VisitorIdSource;
}

// --- Public instance shapes -------------------------------------------------

/**
 * Instance returned by `createConsentify` (no `secret`). The flat methods run
 * against the browser store; pass an object with a `cookieHeader` key
 * ({@link ServerOptions}) as the last argument to run them against a request
 * `Cookie` header instead. Writes also take {@link WriteOptions} metadata.
 */
export interface ConsentifyInstance<Cs extends readonly string[]> {
    readonly policy: { readonly categories: Cs; readonly identifier: string };
    readonly mode: ConsentMode;
    readonly server: {
        get: (cookieHeader: string | null | undefined) => ConsentState<ArrToUnion<Cs>>;
        set: (
            choices: Partial<Choices<ArrToUnion<Cs>>>,
            currentCookieHeader?: string | null,
            opts?: WriteOptions,
        ) => string;
        clear: () => string;
    };
    readonly client: {
        get: () => ConsentState<ArrToUnion<Cs>>;
        set: (choices: Partial<Choices<ArrToUnion<Cs>>>, opts?: WriteOptions) => void;
        clear: () => void;
        subscribe: (callback: () => void) => () => void;
        getServerSnapshot: () => ConsentState<ArrToUnion<Cs>>;
        guard: (
            category: Necessary | ArrToUnion<Cs>,
            onGrant: () => void,
            onRevoke?: () => void,
        ) => () => void;
    };
    /** Client state, or the state in `opts.cookieHeader` (server). */
    readonly get: (opts?: ServerOptions) => ConsentState<ArrToUnion<Cs>>;
    /** Whether `category` is granted. Unset consent follows `mode` (opt-out grants). */
    readonly isGranted: (category: Necessary | ArrToUnion<Cs>, opts?: ServerOptions) => boolean;
    // Server overloads come first so any object with `cookieHeader` resolves to `string`.
    readonly set: {
        /** Server: merges into the consent in `opts.cookieHeader`, returns a `Set-Cookie` header. */
        (choices: Partial<Choices<ArrToUnion<Cs>>>, opts: ServerOptions & WriteOptions): string;
        (choices: Partial<Choices<ArrToUnion<Cs>>>, opts?: WriteOptions): void;
    };
    readonly clear: {
        /** Server: returns a clearing (`Max-Age=0`) `Set-Cookie` header. */
        (opts: ServerOptions): string;
        (): void;
    };
    readonly acceptAll: {
        (opts: ServerOptions & WriteOptions): string;
        (opts?: WriteOptions): void;
    };
    readonly rejectAll: {
        (opts: ServerOptions & WriteOptions): string;
        (opts?: WriteOptions): void;
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
 * Instance returned by `createConsentify` when `secret` is provided
 * (server-only). Adds HMAC-SHA256 signed `getProof()`.
 */
export interface ConsentifyAsyncInstance<Cs extends readonly string[]>
    extends ConsentifyInstance<Cs> {
    /** Signed proof of the client state, or of the consent in `opts.cookieHeader`. `null` when unset. */
    readonly getProof: (opts?: ServerOptions) => Promise<ConsentProof<ArrToUnion<Cs>> | null>;
}

// --- Factory (self-hosted; cloud mode is in `@consentify/core/cloud`) -----
/**
 * Self-hosted mode with HMAC-SHA256 proofs: `secret` is set. Returns an
 * instance with an async `getProof()`. Server-only — passing `secret` in a
 * browser context throws `ConsentifyConfigError`.
 */
export function createConsentify<Cs extends readonly string[]>(
    init: CreateConsentifyInit<Cs> & { secret: string; siteId?: never },
): ConsentifyAsyncInstance<Cs>;
/**
 * Self-hosted mode (default). No proof API; pass `secret` on the server for
 * signed proofs.
 */
export function createConsentify<Cs extends readonly string[]>(
    init: CreateConsentifyInit<Cs> & { siteId?: never },
): ConsentifyInstance<Cs>;
export function createConsentify<Cs extends readonly string[]>(
    init: CreateConsentifyInit<Cs>,
): ConsentifyInstance<Cs> | ConsentifyAsyncInstance<Cs> {
    type T = ArrToUnion<Cs>;
    // Cloud mode lives in its own entry so self-hosted bundles never ship it.
    if ((init as { siteId?: unknown }).siteId) {
        throw new ConsentifyConfigError(TAG + 'siteId: use @consentify/core/cloud');
    }
    if (init.secret && isBrowser()) {
        throw new ConsentifyConfigError(TAG + '`secret` is server-only');
    }
    const policyHash = init.policy.identifier ?? hashPolicy(init.policy.categories);
    const cookieName = init.cookie?.name ?? DEFAULT_COOKIE;
    const sameSite = init.cookie?.sameSite ?? 'Lax';
    const partitioned = init.cookie?.partitioned;
    const consentMaxAgeDays = init.consentMaxAgeDays;
    const cookieCfg: CookieOpt = {
        path: init.cookie?.path ?? '/',
        // Cookie lifetime follows consent lifetime unless set explicitly; default one year.
        maxAgeSec: init.cookie?.maxAgeSec ?? (consentMaxAgeDays || 365) * 86400,
        sameSite,
        secure: sameSite === 'None' || partitioned ? true : (init.cookie?.secure ?? true),
        domain: init.cookie?.domain,
        partitioned,
    };
    const storageOrder: StorageKind[] = (init.storage && init.storage.length > 0) ? init.storage : ['cookie'];
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
        // Unspecified categories follow the mode: opt-out grants, opt-in denies.
        for (const c of init.policy.categories) base[c] = mode === 'opt-out';
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
    const textVersion = init.policy.textVersion;

    // New consent record (format v2) with a random decision `id` (12 hex chars),
    // so two decisions in the same millisecond stay distinct. Unset optional
    // keys are omitted. `pv` and `lang` are coerced and an unknown `source` is
    // dropped, so untyped callers cannot write a record that the next read rejects.
    const record = (choices: Choices<T>, o?: WriteOptions, docLang?: string): Snapshot<T> => {
        const s: Snapshot<T> = { v: 2, id: randomHex(6), policy: policyHash, givenAt: toISO(), choices };
        const lang = o?.lang || init.lang || docLang;
        if (textVersion) s.pv = '' + textVersion;
        if (lang) s.lang = '' + lang;
        if (SOURCES.includes(o?.source)) s.src = o!.source;
        return s;
    };

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

    // ---- server API
    const server = {
        get: (cookieHeader?: string | null): ConsentState<T> => {
            const raw = cookieHeader ? readCookie(cookieName, cookieHeader) : null;
            const s = raw ? dec<Snapshot<T>>(raw) : null;
            if (!s || !isValidSnapshot<T>(s) || s.policy !== policyHash || isExpired(s.givenAt)) return { decision: 'unset' };
            return { decision: 'decided', snapshot: s };
        },
        set: (
            choices: Partial<Choices<T>>,
            currentCookieHeader?: string | null,
            opts?: WriteOptions,
        ): string => {
            const prev = server.get(currentCookieHeader);
            const base = prev.decision === 'decided' ? prev.snapshot.choices : normalize();
            // Metadata is per decision: only `opts` and init, never the previous record.
            const encoded = enc(record(normalize({ ...base, ...choices }), opts));
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
    // An explicit `visitorId` is resolved lazily and cached. The default stored
    // id is re-read on each use: hydration only reads it (`create` false), so
    // a first-time visitor gets no id before deciding; `save` may mint it.
    // Adapter `save`/`load` are fire-and-forget: failures are logged but never
    // bubble up into the consent flow or throw from `client.set`.
    const adapter = init.adapter;
    let visitorIdPromise: Promise<string> | null = null;
    const getVisitorId = (create: boolean): Promise<string> => {
        if (!init.visitorId) return resolveVisitorId(undefined, create);
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
                const data: { visitorId: string; snapshot: Snapshot<T>; proof?: ConsentProof<T> } =
                    { visitorId: await getVisitorId(true), snapshot };
                if (secret) data.proof = await buildProofHmac(snapshot, secret);
                await adapter.save(data);
            } catch (err) {
                logW('adapter.save failed:', err);
            }
        })();
    };


    // Hydrate from adapter on init (browser only, background, local wins on conflict).
    if (adapter && isBrowser()) {
        void (async () => {
            try {
                const visitorId = await getVisitorId(false);
                // First-time visitor (no stored id): nothing to load.
                if (!visitorId && !init.visitorId) return;
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

    // ---- flat API mode switch: an object with a `cookieHeader` key (any value)
    // means server mode. `Object()` keeps `in` safe for primitives from untyped callers.
    const isServer = (opts: unknown): opts is ServerOptions => 'cookieHeader' in Object(opts);
    const stateFor = (opts?: ServerOptions): ConsentState<T> =>
        isServer(opts) ? server.get(opts.cookieHeader) : cachedState;
    const isGranted = (category: Necessary | T, opts?: ServerOptions): boolean => {
        const state = stateFor(opts);
        return category === 'necessary' ||
            (state.decision === 'decided' ? !!state.snapshot.choices[category] : mode === 'opt-out');
    };

    // ---- client API
    const client = {
        get: (): ConsentState<T> => cachedState,

        // An explicit set() is always a new decision: even identical choices
        // are re-written with a fresh `givenAt` (matches `server.set`).
        set: (choices: Partial<Choices<T>>, opts?: WriteOptions) => {
            const from = cachedState;
            const fresh = readClient();
            const base = fresh ? fresh.choices : normalize();
            const next = record(
                normalize({ ...base, ...choices }),
                opts,
                isBrowser() ? document.documentElement?.lang : '',
            );
            writeClientRaw(enc(next));
            setCachedSnapshot(next);
            notifyListeners();
            emit('change', { from, to: cachedState, timestamp: Date.now() });
            checkExpiring();
            bc?.postMessage(null);
            runAdapterSave(next);
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
            // With onRevoke: re-arms after every revoke until disposed.
            // Without onRevoke: one-shot, unsubscribes on first grant.
            let granted = false;

            const tick = () => {
                if (isGranted(category) === granted) return;
                granted = !granted;
                if (!granted) return onRevoke!();
                if (!onRevoke) unsub();
                onGrant();
            };

            const unsub = client.subscribe(tick);
            tick();

            return unsub;
        },
    };

    // --- Flat top-level API (the overloads live on ConsentifyInstance) ---
    const flatSet = (choices: Partial<Choices<T>>, opts?: WriteOptions): string | void =>
        isServer(opts) ? server.set(choices, opts.cookieHeader, opts) : client.set(choices, opts);

    const instance = {
        policy: {
            categories: init.policy.categories,
            identifier: policyHash,
        },
        mode,
        server,
        client,

        get: stateFor,
        isGranted,
        set: flatSet,
        clear: (opts?: ServerOptions): string | void => isServer(opts) ? server.clear() : client.clear(),
        acceptAll: (opts?: WriteOptions) => flatSet(allChoices(true), opts),
        rejectAll: (opts?: WriteOptions) => flatSet(allChoices(false), opts),
        subscribe: client.subscribe,
        getServerSnapshot: client.getServerSnapshot,
        guard: client.guard,
        on,
        once,
        destroy,
    };
    if (!secret) return instance as unknown as ConsentifyInstance<Cs>;
    // Proofs need a server-side secret: an unsigned hash would be forgeable.
    return {
        ...instance,
        getProof: (opts?: ServerOptions): Promise<ConsentProof<T> | null> => {
            const state = stateFor(opts);
            return state.decision === 'decided' ? buildProofHmac(state.snapshot, secret) : Promise.resolve(null);
        },
    } as unknown as ConsentifyAsyncInstance<Cs>;
}

// Common predefined category names you can reuse in your policy.
export const defaultCategories = ['preferences','analytics','marketing','functional','unclassified'] as const;
export type DefaultCategory = typeof defaultCategories[number];

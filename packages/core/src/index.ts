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
    adapter?: ConsentAdapter;
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
    adapter?: ConsentAdapter;
    visitorId?: VisitorIdSource;
}

/**
 * Custom storage backend for mirroring consent state to a user-owned store
 * (e.g. a server-side database). All methods are called fire-and-forget from
 * the SDK: thrown errors are caught and logged via `console.warn`, never
 * bubbled up into the consent flow.
 */
export interface ConsentAdapter {
    save(data: {
        visitorId: string;
        snapshot: Snapshot<any>;
        proof: ConsentProof<any>;
    }): Promise<void>;
    load(visitorId: string): Promise<Snapshot<any> | null>;
}

/**
 * Source for the visitor identifier. Either a concrete string, or a factory
 * function (sync or async) that resolves to one.
 */
export type VisitorIdSource = string | (() => string | Promise<string>);

/**
 * Error thrown on invalid factory configuration or when SaaS config fetch
 * fails. The underlying error (if any) is attached as `cause`.
 */
export class ConsentifyConfigError extends Error {
    constructor(m: string, o?: { cause?: unknown }) {
        super(m);
        this.name = 'ConsentifyConfigError';
        if (o?.cause) (this as { cause?: unknown }).cause = o.cause;
    }
}

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
}

/**
 * Instance returned by `createConsentify` when `secret` is absent (the
 * default). `getProof()` is synchronous and uses the FNV1a fallback signature.
 */
export interface ConsentifyInstance<Cs extends readonly string[]>
    extends ConsentifyInstanceShared<Cs> {
    readonly getProof: {
        (): ConsentProof<ArrToUnion<Cs>> | null;
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

/**
 * Minimal interface for subscribing to consent state changes.
 * Used by `enableConsentMode` and other adapters that need reactive consent state.
 */
export interface ConsentifySubscribable<T extends UserCategory> {
    subscribe: (callback: () => void) => () => void;
    get: () => ConsentState<T>;
    getServerSnapshot: () => ConsentState<T>;
}

// --- Consent mode ---
export type ConsentMode = 'opt-in' | 'opt-out';

// --- Consent proof ---
export interface ConsentProof<T extends UserCategory> {
    policy: string;
    givenAt: string;
    choices: Choices<T>;
    signature: string;
}

// --- Typed event system ---
export interface ConsentEventMap<T extends UserCategory> {
    change: { from: ConsentState<T>; to: ConsentState<T>; timestamp: number };
    clear: { timestamp: number };
    expiring: { expiresAt: number; daysRemaining: number; timestamp: number };
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
const MS_PER_DAY = 86_400_000; // 24 * 60 * 60 * 1000
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

// --- Environment + visitor id helpers ---
const isBrowser = (): boolean =>
    typeof window !== 'undefined' && typeof document !== 'undefined';

const canLocalStorage = (): boolean => {
    try { return isBrowser() && !!window.localStorage; } catch { return false; }
};

const VISITOR_KEY = 'consentify_visitor';

function generateVisitorId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function readOrCreateStoredVisitorId(): string {
    try {
        const stored = window.localStorage.getItem(VISITOR_KEY);
        if (stored) return stored;
        const fresh = generateVisitorId();
        window.localStorage.setItem(VISITOR_KEY, fresh);
        return fresh;
    } catch {
        return generateVisitorId();
    }
}

async function resolveVisitorId(source?: VisitorIdSource): Promise<string> {
    if (typeof source === 'string') return source;
    if (typeof source === 'function') {
        const result = source();
        return typeof result === 'string' ? result : await result;
    }
    if (canLocalStorage()) return readOrCreateStoredVisitorId();
    return '';
}

// --- HMAC-SHA256 signer + verifyProof ---
const toHex = (buf: ArrayBuffer): string =>
    Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');

async function hmacSign(secret: string, payload: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw', enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
    return toHex(sig);
}

/**
 * Verifies an HMAC-SHA256-signed `ConsentProof`. Re-computes the signature
 * from `{policy, givenAt, choices}` using `secret` and compares to
 * `proof.signature`. Returns `false` on mismatch or on any crypto error.
 * FNV1a proofs (the deprecated fallback) will not verify here.
 */
export async function verifyProof<T extends UserCategory>(
    proof: ConsentProof<T>,
    secret: string,
): Promise<boolean> {
    try {
        const body = { policy: proof.policy, givenAt: proof.givenAt, choices: proof.choices };
        const expected = await hmacSign(secret, stableStringify(body));
        return expected === proof.signature;
    } catch {
        return false;
    }
}

// --- Mode B: SiteConfig fetch from CDN ---
interface SiteConfig {
    categories: readonly string[];
    policyIdentifier: string;
    mode?: ConsentMode;
    consentMaxAgeDays?: number;
}

const DEFAULT_CONFIG_ENDPOINT = 'https://cdn.consentify.dev';
const DEFAULT_INGEST_ENDPOINT = 'https://ingest.consentify.dev';
const EVENT_BUFFER_KEY = 'consentify_event_buffer';

type CloudAction = 'accept_all' | 'reject_all' | 'customize';

function deriveCloudAction<T extends UserCategory>(
    state: ConsentState<T>,
    categories: readonly string[],
): CloudAction {
    if (state.decision !== 'decided') return 'customize';
    const choices = state.snapshot.choices as Record<string, boolean>;
    const userCats = categories.filter(c => c !== 'necessary');
    if (userCats.every(c => choices[c] === true)) return 'accept_all';
    if (userCats.every(c => !choices[c])) return 'reject_all';
    return 'customize';
}

interface BufferedEvent { url: string; body: string; apiKey?: string }

function readPendingEvent(): BufferedEvent | null {
    if (!canLocalStorage()) return null;
    try {
        const raw = window.localStorage.getItem(EVENT_BUFFER_KEY);
        return raw ? JSON.parse(raw) as BufferedEvent : null;
    } catch { return null; }
}
function savePendingEvent(evt: BufferedEvent): void {
    if (!canLocalStorage()) return;
    try { window.localStorage.setItem(EVENT_BUFFER_KEY, JSON.stringify(evt)); } catch { /* ignore */ }
}
const dropEvent = () => { if (canLocalStorage()) try { window.localStorage.removeItem(EVENT_BUFFER_KEY); } catch {} };

// fetch with keepalive survives page unload on modern browsers, so a separate
// navigator.sendBeacon path is unnecessary here.
function postCloudEvent(evt: BufferedEvent): Promise<boolean> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (evt.apiKey) headers['X-API-Key'] = evt.apiKey;
    return fetch(evt.url, { method: 'POST', headers, body: evt.body, keepalive: true })
        .then(res => res.ok)
        .catch(() => false);
}

interface StartCloudReportingOptions {
    siteId: string;
    apiKey?: string;
    ingestEndpoint: string;
}

function startCloudReporting<Cs extends readonly string[]>(
    instance: ConsentifyInstance<Cs> | ConsentifyAsyncInstance<Cs>,
    opts: StartCloudReportingOptions,
): () => void {
    if (!isBrowser()) return () => {};
    const url = `${opts.ingestEndpoint.replace(/\/$/, '')}/v1/events`;
    const categories = instance.policy.categories;
    let lastKey = '';

    // Flush any pending event left over from a previous session. Whether the
    // retry succeeds or fails, drop it - no infinite re-queue.
    const pending = readPendingEvent();
    if (pending) void postCloudEvent(pending).finally(dropEvent);

    const visitorHash = canLocalStorage() ? readOrCreateStoredVisitorId() : generateVisitorId();

    const send = (state: ConsentState<ArrToUnion<Cs>>): void => {
        if (state.decision !== 'decided') return;
        const choices = state.snapshot.choices as Record<string, boolean>;
        const key = state.snapshot.policy + ':' + JSON.stringify(choices);
        if (key === lastKey) return;
        lastKey = key;
        const body = JSON.stringify({
            siteId: opts.siteId,
            action: deriveCloudAction(state, categories),
            categories: choices,
            visitorHash,
            policyVersion: state.snapshot.policy,
            ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
        });
        const evt: BufferedEvent = { url, body, apiKey: opts.apiKey };
        void (async () => {
            const ok = await postCloudEvent(evt);
            if (ok) dropEvent(); else savePendingEvent(evt);
        })();
    };

    const current = instance.get();
    if (current.decision === 'decided') send(current);
    return instance.subscribe(() => { send(instance.get()); });
}

async function fetchSiteConfig(
    siteId: string,
    configEndpoint: string,
): Promise<SiteConfig> {
    const base = configEndpoint.replace(/\/$/, '');
    try {
        const latestRes = await fetch(`${base}/config/${siteId}/latest.json`);
        if (!latestRes.ok) {
            throw new Error(`latest.json responded with ${latestRes.status}`);
        }
        const latest = await latestRes.json() as { current?: string };
        if (!latest || typeof latest.current !== 'string' || !latest.current) {
            throw new Error('latest.json is missing `current` hash');
        }
        const cfgRes = await fetch(`${base}/config/${siteId}/${latest.current}.json`);
        if (!cfgRes.ok) {
            throw new Error(`${latest.current}.json responded with ${cfgRes.status}`);
        }
        const cfg = await cfgRes.json() as Partial<SiteConfig>;
        if (!cfg || !Array.isArray(cfg.categories) || typeof cfg.policyIdentifier !== 'string') {
            throw new Error('SiteConfig is malformed');
        }
        return {
            categories: cfg.categories,
            policyIdentifier: cfg.policyIdentifier,
            mode: cfg.mode,
            consentMaxAgeDays: cfg.consentMaxAgeDays,
        };
    } catch (cause) {
        throw new ConsentifyConfigError(
            `[consentify] Failed to fetch SiteConfig for "${siteId}"`,
            { cause },
        );
    }
}

// --- Unified Factory (single entry point) ---
/**
 * Self-hosted mode with HMAC-SHA256 proofs: `secret` is set. Returns an
 * instance whose `getProof()` is async. Server-only — passing `secret` in a
 * browser context throws `ConsentifyConfigError`.
 */
export function createConsentify<Cs extends readonly string[]>(
    init: CreateConsentifyInit<Cs> & { secret: string },
): ConsentifyAsyncInstance<Cs>;
/**
 * Self-hosted mode (default): synchronous factory. `getProof()` uses the
 * deprecated FNV1a fallback.
 */
export function createConsentify<Cs extends readonly string[]>(
    init: CreateConsentifyInit<Cs>,
): ConsentifyInstance<Cs>;
/**
 * Cloud / SaaS mode: async factory that fetches SiteConfig from the CDN and
 * auto-enables event reporting to the ingest endpoint.
 */
export function createConsentify(
    init: CloudInit,
): Promise<ConsentifyInstance<readonly string[]> | ConsentifyAsyncInstance<readonly string[]>>;
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
        throw new ConsentifyConfigError(
            '[consentify] `secret` is server-only: do not ship HMAC secrets to the browser',
        );
    }
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
    const mode: ConsentMode = init.mode ?? 'opt-in';
    const expirationWarningDays = init.expirationWarningDays ?? 30;
    if (consentMaxAgeDays && expirationWarningDays >= consentMaxAgeDays) {
        console.warn('[consentify] expirationWarningDays should be less than consentMaxAgeDays');
    }

    const isExpired = (givenAt: string): boolean => {
        if (!consentMaxAgeDays) return false;
        const givenTime = new Date(givenAt).getTime();
        if (isNaN(givenTime)) return true; // Invalid date = expired
        const maxAgeMs = consentMaxAgeDays * MS_PER_DAY;
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

    const allChoices = (grant: boolean): Partial<Choices<T>> => {
        const c: any = {};
        for (const cat of init.policy.categories as unknown as T[]) c[cat] = grant;
        return c;
    };

    // Signature mode: HMAC-SHA256 when `secret` is set (Node-only by the guard
    // above), FNV1a fallback otherwise.
    const hasSecret = typeof init.secret === 'string' && init.secret.length > 0;
    const secret = init.secret ?? '';

    const buildProofSync = (snapshot: Snapshot<T>): ConsentProof<T> => {
        const body = { policy: snapshot.policy, givenAt: snapshot.givenAt, choices: snapshot.choices };
        return { ...body, signature: fnv1a(stableStringify(body)) };
    };

    const buildProofAsync = async (snapshot: Snapshot<T>): Promise<ConsentProof<T>> => {
        const body = { policy: snapshot.policy, givenAt: snapshot.givenAt, choices: snapshot.choices };
        const signature = await hmacSign(secret, stableStringify(body));
        return { ...body, signature };
    };

    // --- client-side storage helpers ---
    const readFromStore = (kind: StorageKind): string | null => {
        switch (kind) {
            case 'cookie': return readCookie(cookieName);
            case 'localStorage': try { return canLocalStorage() ? window.localStorage.getItem(cookieName) : null; } catch (err) { console.warn('[consentify] localStorage read failed:', err); return null; }
            default: return null;
        }
    };
    const writeToStore = (kind: StorageKind, value: string) => {
        switch (kind) {
            case 'cookie': writeCookie(cookieName, value, cookieCfg); break;
            case 'localStorage': try { if (canLocalStorage()) window.localStorage.setItem(cookieName, value); } catch (err) { console.warn('[consentify] localStorage write failed:', err); } break;
        }
    };
    const clearCookieHeader = () => buildSetCookieHeader(cookieName, '', { ...cookieCfg, maxAgeSec: 0 });
    const clearStore = (kind: StorageKind) => {
        switch (kind) {
            case 'cookie': if (isBrowser()) document.cookie = clearCookieHeader(); break;
            case 'localStorage': try { if (canLocalStorage()) window.localStorage.removeItem(cookieName); } catch (err) { console.warn('[consentify] localStorage clear failed:', err); } break;
        }
    };
    const firstAvailableStore = (): StorageKind => {
        for (const k of storageOrder) {
            if (k === 'cookie') return 'cookie';
            if (k === 'localStorage' && canLocalStorage()) return 'localStorage';
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

    // --- Expiration warning ---
    let expiringEmittedForGivenAt = '';

    const checkExpiring = (): void => {
        if (!consentMaxAgeDays) return;
        if (cachedState.decision !== 'decided') return;
        const { givenAt } = cachedState.snapshot;
        if (givenAt === expiringEmittedForGivenAt) return;
        const givenMs = new Date(givenAt).getTime();
        if (isNaN(givenMs)) { console.warn('[consentify] Invalid consent timestamp:', givenAt); return; }
        const expiresMs = givenMs + consentMaxAgeDays * MS_PER_DAY;
        const daysRemaining = (expiresMs - Date.now()) / (MS_PER_DAY);
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
        bc.onmessage = () => { try { syncState(); notifyListeners(); checkExpiring(); } catch (err) { console.error('[consentify] BroadcastChannel sync failed:', err); } };
    }
    // ======================================================

    // ---- Adapter + visitor id ----
    // Visitor id is resolved lazily and cached. Adapter `save`/`load` are
    // fire-and-forget: failures are logged but never bubble up into the
    // consent flow or throw from `client.set`.
    const adapter = init.adapter;
    let visitorIdPromise: Promise<string> | null = null;
    const getVisitorId = (): Promise<string> => {
        if (!visitorIdPromise) visitorIdPromise = resolveVisitorId(init.visitorId);
        return visitorIdPromise;
    };

    const runAdapterSave = (snapshot: Snapshot<T>): void => {
        if (!adapter) return;
        void (async () => {
            try {
                const visitorId = await getVisitorId();
                const proof = hasSecret
                    ? await buildProofAsync(snapshot)
                    : buildProofSync(snapshot);
                await adapter.save({ visitorId, snapshot, proof });
            } catch (err) {
                console.warn('[consentify] adapter.save failed:', err);
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
                // Only hydrate if local storage is still empty - never override
                // a decision the user already made in this browser.
                if (readClient()) return;
                const from = cachedState;
                writeClientRaw(enc(remote));
                syncState();
                notifyListeners();
                emit('change', { from, to: cachedState, timestamp: Date.now() });
                checkExpiring();
                bc?.postMessage(null);
            } catch (err) {
                console.warn('[consentify] adapter.load failed:', err);
            }
        })();
    }

    // ---- client API
    function clientGet(): ConsentState<T>;
    function clientGet(category: Necessary | T): boolean;
    function clientGet(category?: Necessary | T): ConsentState<T> | boolean {
        // Return cached state for React compatibility
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
            const changed = writeClientIfChanged(next);
            if (changed) {
                syncState();
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
    function flatGetProof(cookieHeader?: string): ProofResult | Promise<ProofResult> {
        const state = typeof cookieHeader === 'string' ? server.get(cookieHeader) : cachedState;
        if (state.decision !== 'decided') return hasSecret ? Promise.resolve(null) : null;
        return hasSecret ? buildProofAsync(state.snapshot) : buildProofSync(state.snapshot);
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
        isGranted: (category: Necessary | T): boolean => {
            return clientGet(category as Necessary | T);
        },
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
    };
    return instance as unknown as ConsentifyInstance<Cs> | ConsentifyAsyncInstance<Cs>;
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
    const unsub3 = instance.on('expiring', (e) => log('Consent expiring', e));
    return () => { unsub1(); unsub2(); unsub3(); };
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

    for (const [category, gTypes] of Object.entries(options.mapping) as [string, GoogleConsentType[]][]) {
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

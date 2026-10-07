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
    /**
     * Version of the policy text shown to the user (e.g. `'2026-10-01'`).
     * Recorded as `pv` on every new consent record. It does not invalidate
     * existing consent; change `identifier` for material changes.
     */
    textVersion?: string;
}

/** UI that recorded a consent decision. */
export type ConsentSource = 'banner' | 'preferences' | 'api';

/**
 * Immutable consent record for a specific policy version. Optional keys are
 * omitted when unset; keys are short because the record is stored in a cookie.
 * @template T Category string union captured in the snapshot.
 */
export interface Snapshot<T extends UserCategory> {
    /** Record format. `2` on every new record; absent on v1 records, which are still read. */
    v?: 2;
    /** Random id of the decision (12 lowercase hex chars). On every new record; absent on v1 records. */
    id?: string;
    policy: string;
    givenAt: string;
    choices: Choices<T>;
    /** Policy text version shown to the user (`policy.textVersion`). */
    pv?: string;
    /** Language of the consent UI. */
    lang?: string;
    /** UI that recorded the decision. Records written by a later version may carry a source this one does not know. */
    src?: ConsentSource;
}

/**
 * High-level consent state derived from the presence of a valid snapshot.
 * When no valid snapshot exists for the current policy version, the state is `unset`.
 */
export type ConsentState<T extends UserCategory> =
| {decision: 'unset'}
| {decision: 'decided', snapshot: Snapshot<T>}

/** Utility to turn a readonly string[] into a string union */
export type ArrToUnion<T extends readonly string[]> = T[number];

/** Storage kinds: keep only widely used options for SSR apps */
export type StorageKind = 'cookie' | 'localStorage';

/** Consent mode */
export type ConsentMode = 'opt-in' | 'opt-out';

/**
 * Passing an object with a `cookieHeader` key to a flat instance method
 * (`get`, `isGranted`, `set`, `clear`, `acceptAll`, `rejectAll`) selects
 * server mode. The key is what counts: `cookieHeader` is the raw request
 * `Cookie` header, and `undefined`, `null` or `''` mean no cookie.
 */
export interface ServerOptions {
    cookieHeader: string | null | undefined;
}

/** Per-write metadata for `set`, `acceptAll` and `rejectAll`, stored on the consent record. */
export interface WriteOptions {
    /** UI that recorded the decision, stored as `src`. */
    source?: ConsentSource;
    /** Language of the consent UI, stored as `lang`. Overrides the init `lang` and `<html lang>`. */
    lang?: string;
}

/** HMAC-SHA256 signed consent proof: the signed record fields plus `signature`. */
export interface ConsentProof<T extends UserCategory> extends Snapshot<T> {
    signature: string;
}

/** Typed event map emitted by a Consentify instance. */
export interface ConsentEventMap<T extends UserCategory> {
    change: { from: ConsentState<T>; to: ConsentState<T>; timestamp: number };
    clear: { timestamp: number };
    expiring: { expiresAt: number; daysRemaining: number; timestamp: number };
}

export type ConsentEventHandler<T extends UserCategory, K extends keyof ConsentEventMap<T>> =
    (event: ConsentEventMap<T>[K]) => void;

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
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'ConsentifyConfigError';
    }
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

/**
 * Custom storage backend for mirroring consent state to a user-owned store
 * (e.g. a server-side database). All methods are called fire-and-forget from
 * the SDK: thrown errors are caught and logged via `console.warn`, never
 * bubbled up into the consent flow.
 *
 * The generic parameter `T` carries the category union from the policy so
 * adapter implementations preserve type-safety end-to-end. Defaults to
 * `UserCategory` (a plain string) for adapters that want to accept any shape.
 */
export interface ConsentAdapter<T extends UserCategory = UserCategory> {
    save(data: {
        visitorId: string;
        snapshot: Snapshot<T>;
        /**
         * HMAC-SHA256 proof of `snapshot`. Present only when the instance was
         * created with a `secret` (server side); browser instances have none.
         */
        proof?: ConsentProof<T>;
    }): Promise<void>;
    load(visitorId: string): Promise<Snapshot<T> | null>;
}

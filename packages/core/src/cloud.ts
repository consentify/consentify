// Cloud (SaaS) entry: `@consentify/core/cloud`.
//
// Kept apart from the main entry so self-hosted apps never ship the SaaS
// client. The ESM build uses esbuild code splitting, so the core code this
// file shares with `@consentify/core` exists once at runtime (one
// `ConsentifyConfigError` class, one cookie/storage implementation).

import {
    createConsentify,
    type ConsentifyAsyncInstance,
    type ConsentifyInstance,
    type CreateConsentifyInit,
} from './index';
import type { ConsentAdapter, ConsentMode, StorageKind, VisitorIdSource } from './internal/types';
import { ConsentifyConfigError } from './internal/types';
import {
    DEFAULT_CONFIG_ENDPOINT,
    DEFAULT_INGEST_ENDPOINT,
    SERVER_KEY_HEADER,
    deriveCloudAction,
    eventBody,
    eventsUrl,
    loadSiteConfig,
    postEvent,
    startCloudReporting,
    type SiteConfig,
    type SiteConfigSource,
} from './internal/cloud';
import { TAG, hashPolicy, isBrowser, logW } from './internal/util';
import { resolveVisitorId } from './internal/visitor';

export type { IngestEvent, SiteConfig, SiteConfigSource, Vendor } from './internal/cloud';

/**
 * Local policy used when no SiteConfig is available: the CDN is unreachable,
 * times out, answers non-OK or serves a malformed config, and nothing is
 * cached.
 */
export interface CloudFallback {
    categories: readonly string[];
    /**
     * Set this to the `policyIdentifier` published for the site. Otherwise the
     * fallback has a different policy version (the category hash), and
     * returning visitors see the banner again while the fallback is active.
     */
    identifier?: string;
    /** Policy text version recorded as `pv` while the fallback is active (`policyTextVersion` in a SiteConfig). */
    textVersion?: string;
    mode?: ConsentMode;
    consentMaxAgeDays?: number;
}

/** Cloud context of an instance, exposed as `instance.cloud`. */
export interface CloudInfo {
    /**
     * `network`: fetched now. `cache`: fresh cached copy, no request.
     * `stale`: expired cached copy, refreshed in the background for the next
     * load. `fallback`: built from `init.fallback`.
     */
    readonly source: SiteConfigSource;
    /** The SiteConfig the instance was built from (the fallback in SiteConfig shape when `source` is `fallback`). */
    readonly config: SiteConfig;
    /** `init.siteId`. */
    readonly siteId: string;
    /** Ingest base URL in use (`init.endpoints.ingest` or the default); `reportConsent` posts there too. */
    readonly ingest: string;
}

/**
 * Init for `createCloudConsentify`. The factory loads the SiteConfig (cache
 * first, then the CDN, then `fallback`), derives `policy` and `mode` from it,
 * and auto-enables cloud event reporting to the ingest endpoint. Local
 * overrides take precedence over values from the SiteConfig.
 */
export interface CloudInit {
    siteId: string;
    /**
     * Public key of the site, sent as the `X-Consentify-Key` header with
     * browser events (never in the body). Not a secret: it ships in your
     * client bundle. Server reporting uses a server key (`reportConsent`).
     */
    publicKey?: string;
    endpoints?: { config?: string; ingest?: string };
    /** Required. Used when no SiteConfig is available, so a CDN outage never breaks consent. */
    fallback: CloudFallback;
    /** Deadline for the whole SiteConfig fetch (both CDN hops), in ms. Default `3000`. */
    timeoutMs?: number;
    /** How long a cached SiteConfig counts as fresh, in seconds. Default `3600`. */
    configTtlSec?: number;
    /**
     * Oldest cached SiteConfig still served while it revalidates, in seconds.
     * An older cache entry is treated like no cache: the factory waits for
     * the CDN (and uses `fallback` if that fails). Default `604800` (7 days).
     */
    configMaxStaleSec?: number;
    cookie?: CreateConsentifyInit<readonly string[]>['cookie'];
    mode?: ConsentMode;
    consentMaxAgeDays?: number;
    expirationWarningDays?: number;
    storage?: StorageKind[];
    /** Language of the consent UI, recorded as `lang`. Same as in `createConsentify`. */
    lang?: string;
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

/**
 * Cloud / SaaS mode with HMAC-SHA256 proofs: `secret` is set. Server-only.
 * Resolves to an async instance whose `getProof()` is HMAC-signed.
 */
export function createCloudConsentify(
    init: CloudInit & { policy?: never; secret: string },
): Promise<ConsentifyAsyncInstance<readonly string[]> & { readonly cloud: CloudInfo }>;
/**
 * Cloud / SaaS mode: loads the SiteConfig (cache, CDN, or `fallback`) and
 * auto-enables event reporting to the ingest endpoint (browser only). Never
 * rejects for network or SiteConfig problems.
 */
export function createCloudConsentify(
    init: CloudInit & { policy?: never },
): Promise<ConsentifyInstance<readonly string[]> & { readonly cloud: CloudInfo }>;
export async function createCloudConsentify(
    init: CloudInit,
): Promise<(ConsentifyInstance<readonly string[]> | ConsentifyAsyncInstance<readonly string[]>) & { readonly cloud: CloudInfo }> {
    const fb = init.fallback;
    // Fail fast: without a fallback the first CDN outage would break consent.
    if (!fb || !Array.isArray(fb.categories)) {
        throw new ConsentifyConfigError(TAG + '`fallback.categories` is required');
    }

    // 1. Resolve the SiteConfig (policy categories, identifier, defaults).
    const [source, fetched] = await loadSiteConfig(
        init.siteId,
        init.endpoints?.config ?? DEFAULT_CONFIG_ENDPOINT,
        init.timeoutMs ?? 3000,
        (init.configTtlSec ?? 3600) * 1000,
        (init.configMaxStaleSec ?? 604800) * 1000,
    );
    if (!fetched) logW(`SiteConfig for "${init.siteId}" unavailable, using fallback`);
    const siteCfg: SiteConfig = fetched ?? {
        categories: fb.categories,
        policyIdentifier: fb.identifier ?? hashPolicy(fb.categories),
        policyTextVersion: fb.textVersion,
        mode: fb.mode,
        consentMaxAgeDays: fb.consentMaxAgeDays,
    };

    // 2. Build a self-hosted instance from it; local overrides win.
    const coreInit: CreateConsentifyInit<readonly string[]> = {
        policy: {
            categories: siteCfg.categories,
            identifier: siteCfg.policyIdentifier,
            textVersion: siteCfg.policyTextVersion,
        },
        lang: init.lang,
        cookie: init.cookie,
        mode: init.mode ?? siteCfg.mode,
        consentMaxAgeDays: init.consentMaxAgeDays ?? siteCfg.consentMaxAgeDays,
        expirationWarningDays: init.expirationWarningDays,
        storage: init.storage,
        secret: init.secret,
        adapter: init.adapter,
        visitorId: init.visitorId,
    };
    const instance = createConsentify(coreInit);
    const ingest = init.endpoints?.ingest ?? DEFAULT_INGEST_ENDPOINT;

    // 3. Report consent decisions to the ingest endpoint (browser only;
    // server-side decisions go through `reportConsent`).
    if (isBrowser()) {
        startCloudReporting(instance, {
            siteId: init.siteId,
            publicKey: init.publicKey,
            ingestEndpoint: ingest,
            visitorId: init.visitorId,
        });
    }
    return Object.assign(instance, { cloud: { source, config: siteCfg, siteId: init.siteId, ingest } });
}

/** Options for {@link reportConsent}: exactly one of `setCookie` and `cookieHeader`. */
export type ReportConsentOptions = {
    /** Server key of the site, sent as `X-Consentify-Server-Key`. Keep it on the server. */
    serverKey: string;
    /** Your own id for the visitor, sent as `visitorHash`. Without it the event has no `visitorHash`. */
    visitorId?: VisitorIdSource;
    /** Deadline for the request, in ms. Default `3000`. */
    timeoutMs?: number;
} & (
    | {
        /** The `Set-Cookie` header a server write (`set` / `acceptAll` / `rejectAll` with `{ cookieHeader }`) returned. */
        setCookie: string;
        cookieHeader?: never;
    }
    | {
        /** A request `Cookie` header that carries the consent record. */
        cookieHeader: string | null | undefined;
        setCookie?: never;
    }
);

/**
 * Reports a consent decision made on the server (e.g. in a Next.js Server
 * Action) to the ingest endpoint, which browser reporting never sees. Reads
 * the record from `setCookie` (what the write returned) or `cookieHeader`,
 * adds an HMAC `proof` when the instance has a `secret`, and POSTs an ingest
 * v2 event to `consent.cloud.ingest` with the server key. Server-only: throws
 * `ConsentifyConfigError` in a browser, where the key would leak.
 *
 * Resolves `true` when the ingest endpoint answered 2xx, and `false` when
 * there is no valid record for the instance's policy (unset, cleared,
 * expired) or the request failed or timed out. Never rejects.
 */
export function reportConsent(
    consent: ConsentifyInstance<readonly string[]> & { readonly cloud: CloudInfo },
    opts: ReportConsentOptions,
): Promise<boolean> {
    if (isBrowser()) throw new ConsentifyConfigError(TAG + 'reportConsent is server-only');
    // The leading `name=value` pair of a Set-Cookie header is a valid Cookie header.
    const cookieHeader = opts.setCookie != null ? opts.setCookie.split(';')[0] : opts.cookieHeader;
    const state = consent.get({ cookieHeader });
    if (state.decision !== 'decided') return Promise.resolve(false);
    const getProof = (consent as Partial<ConsentifyAsyncInstance<readonly string[]>>).getProof;
    return (async () => {
        // No stored id on the server: only an explicit `visitorId` is sent.
        // A failing factory drops `visitorHash`, not the event.
        const visitorHash = opts.visitorId && await resolveVisitorId(opts.visitorId).catch(err => {
            logW('visitorId failed:', err);
            return '';
        });
        const proof = getProof && await getProof({ cookieHeader });
        const action = deriveCloudAction(state, consent.policy.categories.filter(c => c !== 'necessary'));
        return postEvent(
            eventsUrl(consent.cloud.ingest),
            eventBody(consent.cloud.siteId, action, state.snapshot, visitorHash || undefined, proof || undefined),
            { [SERVER_KEY_HEADER]: opts.serverKey },
            AbortSignal.timeout(opts.timeoutMs ?? 3000),
        );
    })().catch(err => {
        logW('reportConsent failed:', err);
        return false;
    });
}

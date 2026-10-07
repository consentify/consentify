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
    loadSiteConfig,
    startCloudReporting,
    type SiteConfig,
    type SiteConfigSource,
} from './internal/cloud';
import { TAG, hashPolicy, isBrowser, logW } from './internal/util';

export type { SiteConfig, SiteConfigSource } from './internal/cloud';

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
    mode?: ConsentMode;
    consentMaxAgeDays?: number;
}

/** Outcome of the SiteConfig lookup, exposed as `instance.cloud`. */
export interface CloudInfo {
    /**
     * `network`: fetched now. `cache`: fresh cached copy, no request.
     * `stale`: expired cached copy, refreshed in the background for the next
     * load. `fallback`: built from `init.fallback`.
     */
    readonly source: SiteConfigSource;
    /** The SiteConfig the instance was built from (the fallback in SiteConfig shape when `source` is `fallback`). */
    readonly config: SiteConfig;
}

/**
 * Init for `createCloudConsentify`. The factory loads the SiteConfig (cache
 * first, then the CDN, then `fallback`), derives `policy` and `mode` from it,
 * and auto-enables cloud event reporting to the ingest endpoint. Local
 * overrides take precedence over values from the SiteConfig.
 */
export interface CloudInit {
    siteId: string;
    apiKey?: string;
    endpoints?: { config?: string; ingest?: string };
    /** Required. Used when no SiteConfig is available, so a CDN outage never breaks consent. */
    fallback: CloudFallback;
    /** Deadline for the whole SiteConfig fetch (both CDN hops), in ms. Default `3000`. */
    timeoutMs?: number;
    /** How long a cached SiteConfig counts as fresh, in seconds. Default `3600`. */
    configTtlSec?: number;
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
    );
    if (!fetched) logW(`SiteConfig for "${init.siteId}" unavailable, using fallback`);
    const siteCfg: SiteConfig = fetched ?? {
        categories: fb.categories,
        policyIdentifier: fb.identifier ?? hashPolicy(fb.categories),
        mode: fb.mode,
        consentMaxAgeDays: fb.consentMaxAgeDays,
    };

    // 2. Build a self-hosted instance from it; local overrides win.
    const coreInit: CreateConsentifyInit<readonly string[]> = {
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
    const instance = createConsentify(coreInit);

    // 3. Report consent decisions to the ingest endpoint (browser only).
    if (isBrowser()) {
        startCloudReporting(instance, {
            siteId: init.siteId,
            apiKey: init.apiKey,
            ingestEndpoint: init.endpoints?.ingest ?? DEFAULT_INGEST_ENDPOINT,
            visitorId: init.visitorId,
        });
    }
    return Object.assign(instance, { cloud: { source, config: siteCfg } });
}

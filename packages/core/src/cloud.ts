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
import {
    DEFAULT_CONFIG_ENDPOINT,
    DEFAULT_INGEST_ENDPOINT,
    fetchSiteConfig,
    startCloudReporting,
} from './internal/cloud';
import { isBrowser } from './internal/util';

export type { SiteConfig } from './internal/cloud';

/**
 * Init for `createCloudConsentify`. The factory fetches a SiteConfig from the
 * CDN, derives `policy` and `mode` from it, and auto-enables cloud event
 * reporting to the ingest endpoint. Local overrides take precedence over
 * values from the fetched SiteConfig.
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

/**
 * Cloud / SaaS mode with HMAC-SHA256 proofs: `secret` is set. Server-only.
 * Resolves to an async instance whose `getProof()` is HMAC-signed.
 */
export function createCloudConsentify(
    init: CloudInit & { policy?: never; secret: string },
): Promise<ConsentifyAsyncInstance<readonly string[]>>;
/**
 * Cloud / SaaS mode: fetches SiteConfig from the CDN and auto-enables event
 * reporting to the ingest endpoint (browser only).
 */
export function createCloudConsentify(
    init: CloudInit & { policy?: never },
): Promise<ConsentifyInstance<readonly string[]>>;
export async function createCloudConsentify(
    init: CloudInit,
): Promise<ConsentifyInstance<readonly string[]> | ConsentifyAsyncInstance<readonly string[]>> {
    // 1. Resolve the SiteConfig (policy categories, identifier, defaults).
    const siteCfg = await fetchSiteConfig(init.siteId, init.endpoints?.config ?? DEFAULT_CONFIG_ENDPOINT);

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
        });
    }
    return instance;
}

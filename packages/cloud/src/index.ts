/** @deprecated Use createConsentify({ siteId }) from @consentify/core instead. */
export interface EnableCloudOptions {
    siteId: string;
    apiKey?: string;
    endpoint?: string;
}

/**
 * @deprecated This package is no longer maintained. All cloud functionality
 * (event reporting, visitor hash, dedup, retry buffer) now lives in
 * `@consentify/core` via `createConsentify({ siteId, apiKey })` (Mode B).
 * Calling `enableCloud` is a no-op and emits a console warning. Remove this
 * package from your dependencies and migrate to core's Mode B.
 *
 * See https://github.com/consentify/consentify for the migration guide.
 */
export function enableCloud(_instance: unknown, _options: EnableCloudOptions): () => void {
    console.warn(
        '[consentify] @consentify/cloud is deprecated and is now a no-op. ' +
        'Use createConsentify({ siteId, apiKey }) from @consentify/core instead. ' +
        'See https://github.com/consentify/consentify for migration guide.',
    );
    return () => {};
}

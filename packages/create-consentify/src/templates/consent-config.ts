import { formatGcmMapping } from './gcm-mapping.js';
import { envPrefix, type TemplateContext } from './types.js';

function coreImports(ctx: TemplateContext): string {
    const names = ['createConsentify'];
    if (ctx.enableGcm) names.push('enableConsentMode');
    return `import { ${names.join(', ')} } from '@consentify/core';`;
}

function categoriesLiteral(categories: readonly string[]): string {
    return categories.map((c) => `'${c}'`).join(', ');
}

function gcmBlock(ctx: TemplateContext): string {
    if (!ctx.enableGcm) return '';
    return `
enableConsentMode(consent, {
    mapping: {
${formatGcmMapping(ctx.categories)}
    },
});
`;
}

export function generateConsentConfig(ctx: TemplateContext): string {
    const header = coreImports(ctx);

    if (ctx.useSaas) {
        // Mode B (SaaS): createConsentify becomes async and fetches SiteConfig
        // from the CDN. `policy.categories` comes from the dashboard; local
        // overrides (`mode`) take precedence over the fetched config.
        const prefix = envPrefix(ctx.framework);
        const siteIdExpr = prefix
            ? `process.env.${prefix}CONSENTIFY_SITE_ID!`
            : `process.env.CONSENTIFY_SITE_ID!`;
        const apiKeyExpr = prefix
            ? `process.env.${prefix}CONSENTIFY_API_KEY`
            : `process.env.CONSENTIFY_API_KEY`;
        const body = `
// SaaS mode: categories + policy version are fetched from consentify.dev on init.
// Top-level await requires ESM ("type": "module") - standard for modern toolchains.
export const consent = await createConsentify({
    siteId: ${siteIdExpr},
    apiKey: ${apiKeyExpr},
    mode: '${ctx.mode}',
});
`;
        return [header, body, gcmBlock(ctx)]
            .filter((s) => s.trim().length > 0)
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trimEnd() + '\n';
    }

    const body = `
export const consent = createConsentify({
    policy: {
        categories: [${categoriesLiteral(ctx.categories)}] as const,
    },
    mode: '${ctx.mode}',
});
`;

    return [header, body, gcmBlock(ctx)]
        .filter((s) => s.trim().length > 0)
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd() + '\n';
}

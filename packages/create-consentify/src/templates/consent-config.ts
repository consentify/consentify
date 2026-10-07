import { formatGcmMapping } from './gcm-mapping.js';
import { envPrefix, type TemplateContext } from './types.js';

// SaaS mode imports its factory from the `@consentify/core/cloud` subpath so
// self-hosted bundles never ship the cloud client.
export function sdkImports(ctx: TemplateContext): string {
    const names = ctx.useSaas ? [] : ['createConsentify'];
    if (ctx.enableGcm) names.push('enableConsentMode');
    const lines = names.length ? [`import { ${names.join(', ')} } from '@consentify/core';`] : [];
    if (ctx.useSaas) lines.push(`import { createCloudConsentify } from '@consentify/core/cloud';`);
    return lines.join('\n');
}

function categoriesLiteral(categories: readonly string[]): string {
    return categories.map((c) => `'${c}'`).join(', ');
}

// Local policy `createCloudConsentify` uses when the CDN is unreachable and
// nothing is cached; built from the categories/mode picked in the wizard.
export function fallbackBlock(ctx: TemplateContext, indent: string): string {
    return [
        `// Used when the CDN is unreachable and no SiteConfig is cached.`,
        `fallback: {`,
        `    categories: [${categoriesLiteral(ctx.categories)}],`,
        `    mode: '${ctx.mode}',`,
        `    // Set to your published policy identifier so returning visitors keep their consent:`,
        `    // identifier: 'your-policy-identifier',`,
        `},`,
    ].map((l) => indent + l).join('\n');
}

function gcmBlock(ctx: TemplateContext): string {
    if (!ctx.enableGcm) return '';
    return `
enableConsentMode(consent, {
    mapping: {
        necessary: ['security_storage'],
${formatGcmMapping(ctx.categories)}
    },
    // The <head> snippet already sent gtag('consent', 'default').
    sendDefault: false,
});
`;
}

export function generateConsentConfig(ctx: TemplateContext): string {
    const header = sdkImports(ctx);

    if (ctx.useSaas) {
        // SaaS: createCloudConsentify is async and fetches SiteConfig
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
export const consent = await createCloudConsentify({
    siteId: ${siteIdExpr},
    apiKey: ${apiKeyExpr},
    mode: '${ctx.mode}',
${fallbackBlock(ctx, '    ')}
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

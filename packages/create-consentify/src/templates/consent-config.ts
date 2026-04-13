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

function cloudBlock(ctx: TemplateContext): string {
    if (!ctx.useSaas) return '';
    const prefix = envPrefix(ctx.framework);
    const siteIdExpr = prefix
        ? `process.env.${prefix}CONSENTIFY_SITE_ID!`
        : `process.env.CONSENTIFY_SITE_ID!`;
    const apiKeyExpr = prefix
        ? `process.env.${prefix}CONSENTIFY_API_KEY`
        : `process.env.CONSENTIFY_API_KEY`;
    return `
if (typeof window !== 'undefined') {
    enableCloud(consent, {
        siteId: ${siteIdExpr},
        apiKey: ${apiKeyExpr},
    });
}
`;
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
    const header = [
        coreImports(ctx),
        ctx.useSaas ? `import { enableCloud } from '@consentify/cloud';` : null,
    ]
        .filter(Boolean)
        .join('\n');

    const body = `
export const consent = createConsentify({
    policy: {
        categories: [${categoriesLiteral(ctx.categories)}] as const,
    },
    mode: '${ctx.mode}',
});
`;

    return [header, body, gcmBlock(ctx), cloudBlock(ctx)]
        .filter((s) => s.trim().length > 0)
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd() + '\n';
}

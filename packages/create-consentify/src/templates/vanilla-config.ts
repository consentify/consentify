import { formatGcmMapping } from './gcm-mapping.js';
import type { TemplateContext } from './types.js';

export function generateVanillaConfig(ctx: TemplateContext): string {
    const categories = ctx.categories.map((c) => `'${c}'`).join(', ');

    const gcmBlock = ctx.enableGcm
        ? `
enableConsentMode(consent, {
    mapping: {
${formatGcmMapping(ctx.categories, '        ')}
    },
});`
        : '';

    const saasBlock = ctx.useSaas
        ? `
enableCloud(consent, {
    siteId: '${ctx.siteId ?? 'your-site-id-here'}',${ctx.apiKey ? `\n    apiKey: '${ctx.apiKey}',` : ''}
});`
        : '';

    const imports = [
        `import { createConsentify${ctx.enableGcm ? ', enableConsentMode' : ''} } from '@consentify/core';`,
        ctx.useSaas ? `import { enableCloud } from '@consentify/cloud';` : null,
    ]
        .filter(Boolean)
        .join('\n');

    return `${imports}

export const consent = createConsentify({
    policy: {
        categories: [${categories}],
    },
    mode: '${ctx.mode}',
});
${gcmBlock}${saasBlock}

// Example: render a minimal banner when no decision has been made
if (typeof window !== 'undefined') {
    const state = consent.get();
    if (state.decision === 'unset') {
        // TODO: replace this with your consent banner UI
        console.info('[consentify] no decision yet - show banner');
    }
}
`.replace(/\n{3,}/g, '\n\n');
}

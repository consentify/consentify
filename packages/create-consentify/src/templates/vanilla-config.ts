import { sdkImports } from './consent-config.js';
import { formatGcmMapping } from './gcm-mapping.js';
import type { TemplateContext } from './types.js';

export function generateVanillaConfig(ctx: TemplateContext): string {
    const gcmBlock = ctx.enableGcm
        ? `
enableConsentMode(consent, {
    mapping: {
        necessary: ['security_storage'],
${formatGcmMapping(ctx.categories, '        ')}
    },
    // The <head> snippet already sent gtag('consent', 'default').
    sendDefault: false,
});`
        : '';

    const imports = sdkImports(ctx);

    if (ctx.useSaas) {
        const siteId = ctx.siteId ?? 'your-site-id-here';
        const apiKeyLine = ctx.apiKey ? `\n    apiKey: '${ctx.apiKey}',` : '';
        return `${imports}

// SaaS mode: categories + policy version are fetched from consentify.dev on init.
// Top-level await requires ESM ("type": "module") - standard for modern toolchains.
export const consent = await createCloudConsentify({
    siteId: '${siteId}',${apiKeyLine}
    mode: '${ctx.mode}',
});
${gcmBlock}

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

    const categories = ctx.categories.map((c) => `'${c}'`).join(', ');
    return `${imports}

export const consent = createConsentify({
    policy: {
        categories: [${categories}],
    },
    mode: '${ctx.mode}',
});
${gcmBlock}

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

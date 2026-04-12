import { envPrefix, type TemplateContext } from './types.js';

export function generateEnvExample(ctx: TemplateContext): string | null {
    if (!ctx.useSaas) return null;
    const prefix = envPrefix(ctx.framework);
    const siteIdKey = `${prefix}CONSENTIFY_SITE_ID`;
    const apiKeyKey = `${prefix}CONSENTIFY_API_KEY`;
    const siteIdValue = ctx.siteId ?? 'your-site-id-here';
    const apiKeyValue = ctx.apiKey ?? '';

    return `# Consentify dashboard credentials
${siteIdKey}=${siteIdValue}
${apiKeyKey}=${apiKeyValue}
`;
}

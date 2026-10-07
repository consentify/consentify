import { envPrefix, type TemplateContext } from './types.js';

export function generateEnvExample(ctx: TemplateContext): string | null {
    if (!ctx.useSaas) return null;
    const prefix = envPrefix(ctx.framework);
    const siteIdKey = `${prefix}CONSENTIFY_SITE_ID`;
    const publicKeyKey = `${prefix}CONSENTIFY_PUBLIC_KEY`;
    const siteIdValue = ctx.siteId ?? 'your-site-id-here';
    const publicKeyValue = ctx.publicKey ?? '';

    return `# Consentify dashboard credentials (both are public: they ship in the client bundle)
${siteIdKey}=${siteIdValue}
${publicKeyKey}=${publicKeyValue}
`;
}

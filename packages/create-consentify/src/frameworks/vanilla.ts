import { generateVanillaConfig } from '../templates/vanilla-config.js';
import type { FrameworkScaffolder, GeneratedFile } from './types.js';

export const vanilla: FrameworkScaffolder = {
    id: 'vanilla',
    label: 'Vanilla JS / HTML',
    files(ctx) {
        const files: GeneratedFile[] = [
            {
                path: 'consent-config.js',
                content: generateVanillaConfig(ctx),
            },
        ];
        return files;
    },
    runtimeDeps() {
        // SaaS (Mode B) lives in @consentify/core; no separate cloud package needed.
        return ['@consentify/core'];
    },
    instructions(ctx) {
        const lines = [
            `Import consent-config.js from your main entry point:`,
            ``,
            `    import { consent } from './consent-config.js';`,
            ``,
            `Or use the IIFE build via <script>:`,
            ``,
            `    <script src="https://unpkg.com/@consentify/core/dist/consentify.iife.min.js"></script>`,
            `    <script>`,
            `      const consent = Consentify.createConsentify({`,
            `        policy: { categories: ${JSON.stringify(ctx.categories)} },`,
            `        mode: '${ctx.mode}',`,
            `      });`,
            `    </script>`,
        ];
        return lines;
    },
};

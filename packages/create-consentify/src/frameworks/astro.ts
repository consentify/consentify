import { detectAstroReactIntegration } from '../detect/project.js';
import { generateConsentConfig } from '../templates/consent-config.js';
import { generateEnvExample } from '../templates/env-example.js';
import type { FrameworkScaffolder, GeneratedFile } from './types.js';

export const astro: FrameworkScaffolder = {
    id: 'astro',
    label: 'Astro',
    files(ctx) {
        const files: GeneratedFile[] = [
            {
                path: 'src/lib/consent.ts',
                content: generateConsentConfig(ctx),
            },
            {
                path: 'src/components/ConsentBanner.astro',
                content: `---
// Minimal consent banner - rendered on every page until user decides.
---
<div id="consentify-banner" hidden>
    <p>We use cookies to improve your experience.</p>
    <button data-consent-accept>Accept all</button>
    <button data-consent-reject>Reject all</button>
</div>

<script>
    import { consent } from '../lib/consent';

    const banner = document.getElementById('consentify-banner');
    const render = () => {
        const state = consent.get();
        if (banner) banner.hidden = state.decision !== 'unset';
    };

    consent.subscribe(render);
    render();

    document.querySelector('[data-consent-accept]')?.addEventListener('click', () => consent.acceptAll());
    document.querySelector('[data-consent-reject]')?.addEventListener('click', () => consent.rejectAll());
</script>
`,
            },
        ];
        const env = generateEnvExample(ctx);
        if (env) files.push({ path: '.env.example', content: env });
        return files;
    },
    runtimeDeps(ctx, cwd) {
        const deps = ['@consentify/core'];
        if (cwd && detectAstroReactIntegration(cwd)) deps.push('@consentify/react');
        if (ctx.useSaas) deps.push('@consentify/cloud');
        return deps;
    },
    instructions(ctx) {
        const lines = [
            `Import <ConsentBanner /> in your base layout (e.g. src/layouts/Layout.astro):`,
            ``,
            `    ---`,
            `    import ConsentBanner from '../components/ConsentBanner.astro';`,
            `    ---`,
            `    <body>`,
            `      <slot />`,
            `      <ConsentBanner />`,
            `    </body>`,
        ];
        if (ctx.useSaas) {
            lines.push(
                ``,
                `Copy .env.example -> .env and fill in your dashboard credentials.`,
                `Astro exposes PUBLIC_* env vars to client code.`,
            );
        }
        return lines;
    },
};

import { generateConsentConfig } from '../templates/consent-config.js';
import { generateReactProvider } from '../templates/consent-provider.js';
import { generateEnvExample } from '../templates/env-example.js';
import type { FrameworkScaffolder, GeneratedFile } from './types.js';

export const remix: FrameworkScaffolder = {
    id: 'remix',
    label: 'Remix',
    files(ctx) {
        const files: GeneratedFile[] = [
            {
                path: 'app/lib/consent.ts',
                content: generateConsentConfig(ctx),
            },
            {
                path: 'app/components/ConsentProvider.tsx',
                content: generateReactProvider('remix'),
            },
        ];
        const env = generateEnvExample(ctx);
        if (env) files.push({ path: '.env.example', content: env });
        return files;
    },
    runtimeDeps() {
        return ['@consentify/core', '@consentify/react'];
    },
    instructions(ctx) {
        const lines = [
            `Wrap your <Outlet /> in app/root.tsx with <ConsentProvider>:`,
            ``,
            `    import { ConsentProvider } from './components/ConsentProvider';`,
            ``,
            `    export default function App() {`,
            `      return (`,
            `        <ConsentProvider>`,
            `          <Outlet />`,
            `        </ConsentProvider>`,
            `      );`,
            `    }`,
        ];
        if (ctx.useSaas) {
            lines.push(
                ``,
                `In Remix, client-side env access happens via window.ENV.`,
                `Expose CONSENTIFY_SITE_ID from your loader and reference it in the client.`,
            );
        }
        return lines;
    },
};

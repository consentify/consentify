import { generateConsentConfig } from '../templates/consent-config.js';
import { generateReactProvider } from '../templates/consent-provider.js';
import { generateEnvExample } from '../templates/env-example.js';
import type { FrameworkScaffolder, GeneratedFile } from './types.js';

export const viteReact: FrameworkScaffolder = {
    id: 'vite-react',
    label: 'Vite + React',
    files(ctx) {
        const files: GeneratedFile[] = [
            {
                path: 'src/lib/consent.ts',
                content: generateConsentConfig(ctx),
            },
            {
                path: 'src/components/ConsentProvider.tsx',
                content: generateReactProvider('vite-react'),
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
            `Wrap your root in src/main.tsx with <ConsentProvider>:`,
            ``,
            `    import { ConsentProvider } from './components/ConsentProvider';`,
            ``,
            `    createRoot(document.getElementById('root')!).render(`,
            `      <StrictMode>`,
            `        <ConsentProvider>`,
            `          <App />`,
            `        </ConsentProvider>`,
            `      </StrictMode>,`,
            `    );`,
        ];
        if (ctx.useSaas) {
            lines.push(
                ``,
                `Copy .env.example -> .env.local and fill in your dashboard credentials.`,
                `Vite exposes only VITE_* env vars to client code.`,
            );
        }
        return lines;
    },
};

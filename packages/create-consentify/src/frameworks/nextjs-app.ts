import { generateConsentConfig } from '../templates/consent-config.js';
import { generateReactProvider } from '../templates/consent-provider.js';
import { generateEnvExample } from '../templates/env-example.js';
import type { FrameworkScaffolder, GeneratedFile } from './types.js';

export const nextjsApp: FrameworkScaffolder = {
    id: 'nextjs-app',
    label: 'Next.js (App Router)',
    files(ctx) {
        const prefix = ctx.srcDir ? 'src/' : '';
        const files: GeneratedFile[] = [
            {
                path: `${prefix}lib/consent.ts`,
                content: generateConsentConfig(ctx),
            },
            {
                path: `${prefix}components/consent-provider.tsx`,
                content: generateReactProvider('nextjs-app'),
            },
        ];
        const env = generateEnvExample(ctx);
        if (env) files.push({ path: '.env.local.example', content: env });
        return files;
    },
    runtimeDeps(ctx) {
        const deps = ['@consentify/core', '@consentify/react'];
        if (ctx.useSaas) deps.push('@consentify/cloud');
        return deps;
    },
    instructions(ctx) {
        const prefix = ctx.srcDir ? 'src/' : '';
        const lines = [
            `Wrap your root layout (${prefix}app/layout.tsx) children with <ConsentProvider>:`,
            ``,
            `    import { ConsentProvider } from '@/components/consent-provider';`,
            ``,
            `    export default function RootLayout({ children }: { children: React.ReactNode }) {`,
            `      return (`,
            `        <html lang="en">`,
            `          <body>`,
            `            <ConsentProvider>{children}</ConsentProvider>`,
            `          </body>`,
            `        </html>`,
            `      );`,
            `    }`,
        ];
        if (ctx.enableGcm) {
            lines.push(
                ``,
                `For Google Consent Mode v2, add the default <script> to your layout <head>`,
                `BEFORE any GA/GTM scripts (see generated gcm-default.html snippet in the docs).`,
            );
        }
        if (ctx.useSaas) {
            lines.push(
                ``,
                `Copy .env.local.example -> .env.local and fill in your dashboard credentials.`,
            );
        }
        return lines;
    },
};

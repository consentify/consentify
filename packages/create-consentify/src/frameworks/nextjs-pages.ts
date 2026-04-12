import { generateConsentConfig } from '../templates/consent-config.js';
import { generateReactProvider } from '../templates/consent-provider.js';
import { generateEnvExample } from '../templates/env-example.js';
import type { FrameworkScaffolder, GeneratedFile } from './types.js';

export const nextjsPages: FrameworkScaffolder = {
    id: 'nextjs-pages',
    label: 'Next.js (Pages Router)',
    files(ctx) {
        const prefix = ctx.srcDir ? 'src/' : '';
        const files: GeneratedFile[] = [
            {
                path: `${prefix}lib/consent.ts`,
                content: generateConsentConfig(ctx),
            },
            {
                path: `${prefix}components/consent-provider.tsx`,
                content: generateReactProvider('nextjs-pages'),
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
            `Wrap your _app in ${prefix}pages/_app.tsx with <ConsentProvider>:`,
            ``,
            `    import { ConsentProvider } from '@/components/consent-provider';`,
            `    import type { AppProps } from 'next/app';`,
            ``,
            `    export default function App({ Component, pageProps }: AppProps) {`,
            `      return (`,
            `        <ConsentProvider>`,
            `          <Component {...pageProps} />`,
            `        </ConsentProvider>`,
            `      );`,
            `    }`,
        ];
        if (ctx.useSaas) {
            lines.push(
                ``,
                `Copy .env.local.example -> .env.local and fill in your dashboard credentials.`,
            );
        }
        return lines;
    },
};

import type { Framework } from '../detect/project.js';

export type ConsentMode = 'opt-in' | 'opt-out';

export interface TemplateContext {
    framework: Framework;
    categories: readonly string[];
    mode: ConsentMode;
    enableGcm: boolean;
    useSaas: boolean;
    siteId?: string;
    apiKey?: string;
    srcDir: boolean;
}

export function envPrefix(framework: Framework): string {
    switch (framework) {
        case 'nextjs-app':
        case 'nextjs-pages':
            return 'NEXT_PUBLIC_';
        case 'vite-react':
            return 'VITE_';
        case 'astro':
            return 'PUBLIC_';
        case 'remix':
        case 'vanilla':
            return '';
    }
}

import type { Framework } from '../detect/project.js';
import { astro } from './astro.js';
import { nextjsApp } from './nextjs-app.js';
import { nextjsPages } from './nextjs-pages.js';
import { remix } from './remix.js';
import type { FrameworkScaffolder } from './types.js';
import { vanilla } from './vanilla.js';
import { viteReact } from './vite-react.js';

export const FRAMEWORK_REGISTRY: Record<Framework, FrameworkScaffolder> = {
    'nextjs-app': nextjsApp,
    'nextjs-pages': nextjsPages,
    'vite-react': viteReact,
    remix,
    astro,
    vanilla,
};

export function getFramework(id: Framework): FrameworkScaffolder {
    return FRAMEWORK_REGISTRY[id];
}

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type Framework =
    | 'nextjs-app'
    | 'nextjs-pages'
    | 'vite-react'
    | 'remix'
    | 'astro'
    | 'vanilla';

export const FRAMEWORKS: readonly Framework[] = [
    'nextjs-app',
    'nextjs-pages',
    'vite-react',
    'remix',
    'astro',
    'vanilla',
] as const;

export function isFramework(v: unknown): v is Framework {
    return typeof v === 'string' && (FRAMEWORKS as readonly string[]).includes(v);
}

export function detectSrcDir(cwd: string): boolean {
    const srcPath = join(cwd, 'src');
    return existsSync(srcPath) && statSync(srcPath).isDirectory();
}

function readPackageJson(cwd: string): Record<string, unknown> | null {
    const pkgPath = join(cwd, 'package.json');
    if (!existsSync(pkgPath)) return null;
    try {
        return JSON.parse(readFileSync(pkgPath, 'utf8'));
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[create-consentify] Could not parse ${pkgPath}: ${msg}`);
        return null;
    }
}

function allDeps(pkg: Record<string, unknown>): Record<string, string> {
    const deps = (pkg.dependencies as Record<string, string>) ?? {};
    const devDeps = (pkg.devDependencies as Record<string, string>) ?? {};
    return { ...deps, ...devDeps };
}

export function detectFrameworkHint(cwd: string): Framework | null {
    const pkg = readPackageJson(cwd);
    if (!pkg) return null;
    const deps = allDeps(pkg);

    if (deps.next) {
        if (existsSync(join(cwd, 'app')) || existsSync(join(cwd, 'src/app'))) return 'nextjs-app';
        if (existsSync(join(cwd, 'pages')) || existsSync(join(cwd, 'src/pages'))) return 'nextjs-pages';
        return 'nextjs-app';
    }
    if (deps['@remix-run/react'] || deps['@remix-run/node']) return 'remix';
    if (deps.astro) return 'astro';
    if (deps.vite && (deps.react || deps['react-dom'])) return 'vite-react';

    return null;
}

export function detectAstroReactIntegration(cwd: string): boolean {
    const pkg = readPackageJson(cwd);
    if (!pkg) return false;
    const deps = allDeps(pkg);
    return Boolean(deps['@astrojs/react']);
}

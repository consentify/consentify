import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FRAMEWORK_REGISTRY } from '../frameworks/index.js';
import type { TemplateContext } from '../templates/types.js';

function ctx(overrides: Partial<TemplateContext> = {}): TemplateContext {
    return {
        framework: 'nextjs-app',
        categories: ['analytics', 'marketing'],
        mode: 'opt-in',
        enableGcm: false,
        useSaas: false,
        srcDir: false,
        ...overrides,
    };
}

describe('nextjs-app scaffolder', () => {
    const scaffolder = FRAMEWORK_REGISTRY['nextjs-app'];

    it('writes lib/consent.ts and components/consent-provider.tsx at project root', () => {
        const files = scaffolder.files(ctx({ framework: 'nextjs-app' }));
        const paths = files.map((f) => f.path);
        expect(paths).toContain('lib/consent.ts');
        expect(paths).toContain('components/consent-provider.tsx');
    });

    it('writes under src/ when srcDir is true', () => {
        const files = scaffolder.files(ctx({ framework: 'nextjs-app', srcDir: true }));
        const paths = files.map((f) => f.path);
        expect(paths).toContain('src/lib/consent.ts');
        expect(paths).toContain('src/components/consent-provider.tsx');
    });

    it('adds @consentify/react as a runtime dep', () => {
        const deps = scaffolder.runtimeDeps(ctx({ framework: 'nextjs-app' }));
        expect(deps).toContain('@consentify/core');
        expect(deps).toContain('@consentify/react');
        expect(deps).not.toContain('@consentify/cloud');
    });

    it('never adds @consentify/cloud (deprecated - SaaS lives in @consentify/core Mode B)', () => {
        const deps = scaffolder.runtimeDeps(ctx({ framework: 'nextjs-app', useSaas: true }));
        expect(deps).not.toContain('@consentify/cloud');
        expect(deps).toContain('@consentify/core');
    });

    it('emits .env.local.example only in SaaS mode', () => {
        const without = scaffolder.files(ctx()).map((f) => f.path);
        expect(without).not.toContain('.env.local.example');
        const withSaas = scaffolder.files(ctx({ useSaas: true, siteId: 'abc' })).map((f) => f.path);
        expect(withSaas).toContain('.env.local.example');
    });
});

describe('vite-react scaffolder', () => {
    const scaffolder = FRAMEWORK_REGISTRY['vite-react'];

    it('always writes under src/', () => {
        const files = scaffolder.files(ctx({ framework: 'vite-react', srcDir: false }));
        const paths = files.map((f) => f.path);
        expect(paths).toContain('src/lib/consent.ts');
        expect(paths).toContain('src/components/ConsentProvider.tsx');
    });
});

describe('astro scaffolder', () => {
    const scaffolder = FRAMEWORK_REGISTRY.astro;
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'cc-astro-'));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('does NOT include @consentify/react without @astrojs/react in package.json', () => {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { astro: '5' } }));
        const deps = scaffolder.runtimeDeps(ctx({ framework: 'astro' }), dir);
        expect(deps).toEqual(['@consentify/core']);
    });

    it('includes @consentify/react when @astrojs/react is detected in package.json', () => {
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({ dependencies: { astro: '5', '@astrojs/react': '4' } }),
        );
        const deps = scaffolder.runtimeDeps(ctx({ framework: 'astro' }), dir);
        expect(deps).toContain('@consentify/react');
    });

    it('writes an Astro component file', () => {
        const files = scaffolder.files(ctx({ framework: 'astro' }));
        const paths = files.map((f) => f.path);
        expect(paths).toContain('src/components/ConsentBanner.astro');
    });
});

describe('vanilla scaffolder', () => {
    const scaffolder = FRAMEWORK_REGISTRY.vanilla;

    it('never includes @consentify/react', () => {
        const deps = scaffolder.runtimeDeps(ctx({ framework: 'vanilla' }));
        expect(deps).not.toContain('@consentify/react');
    });

    it('writes a plain JS config file', () => {
        const files = scaffolder.files(ctx({ framework: 'vanilla' }));
        expect(files.map((f) => f.path)).toContain('consent-config.js');
    });
});

describe('remix scaffolder', () => {
    const scaffolder = FRAMEWORK_REGISTRY.remix;

    it('writes files under app/ (not src/)', () => {
        const files = scaffolder.files(ctx({ framework: 'remix' }));
        const paths = files.map((f) => f.path);
        expect(paths).toContain('app/lib/consent.ts');
        expect(paths).toContain('app/components/ConsentProvider.tsx');
    });
});

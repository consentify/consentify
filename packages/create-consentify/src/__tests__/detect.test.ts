import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectPackageManager } from '../detect/package-manager.js';
import {
    detectAstroReactIntegration,
    detectFrameworkHint,
    detectSrcDir,
} from '../detect/project.js';

let dir: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cc-detect-'));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('detectPackageManager', () => {
    it('detects pnpm from pnpm-lock.yaml', () => {
        writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
        expect(detectPackageManager(dir)).toBe('pnpm');
    });

    it('detects bun from bun.lockb', () => {
        writeFileSync(join(dir, 'bun.lockb'), '');
        expect(detectPackageManager(dir)).toBe('bun');
    });

    it('detects yarn from yarn.lock', () => {
        writeFileSync(join(dir, 'yarn.lock'), '');
        expect(detectPackageManager(dir)).toBe('yarn');
    });

    it('detects npm from package-lock.json', () => {
        writeFileSync(join(dir, 'package-lock.json'), '{}');
        expect(detectPackageManager(dir)).toBe('npm');
    });

    it('prefers pnpm when multiple lockfiles are present', () => {
        writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
        writeFileSync(join(dir, 'package-lock.json'), '{}');
        expect(detectPackageManager(dir)).toBe('pnpm');
    });
});

describe('detectSrcDir', () => {
    it('returns false when src/ is missing', () => {
        expect(detectSrcDir(dir)).toBe(false);
    });

    it('returns true when src/ exists', () => {
        mkdirSync(join(dir, 'src'));
        expect(detectSrcDir(dir)).toBe(true);
    });
});

describe('detectFrameworkHint', () => {
    it('returns null when no package.json exists', () => {
        expect(detectFrameworkHint(dir)).toBeNull();
    });

    it('detects Next.js App Router when next + app/ present', () => {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '15.0.0' } }));
        mkdirSync(join(dir, 'app'));
        expect(detectFrameworkHint(dir)).toBe('nextjs-app');
    });

    it('detects Next.js Pages Router when pages/ present', () => {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '14.0.0' } }));
        mkdirSync(join(dir, 'pages'));
        expect(detectFrameworkHint(dir)).toBe('nextjs-pages');
    });

    it('detects Vite + React', () => {
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({ devDependencies: { vite: '6.0.0' }, dependencies: { react: '19' } }),
        );
        expect(detectFrameworkHint(dir)).toBe('vite-react');
    });

    it('detects Astro', () => {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { astro: '5.0.0' } }));
        expect(detectFrameworkHint(dir)).toBe('astro');
    });
});

describe('detectAstroReactIntegration', () => {
    it('returns true when @astrojs/react is installed', () => {
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({ dependencies: { astro: '5', '@astrojs/react': '4' } }),
        );
        expect(detectAstroReactIntegration(dir)).toBe(true);
    });

    it('returns false when absent', () => {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { astro: '5' } }));
        expect(detectAstroReactIntegration(dir)).toBe(false);
    });
});

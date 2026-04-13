import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

const LOCKFILES: Array<[string, PackageManager]> = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
];

export function detectPackageManager(cwd: string): PackageManager | null {
    for (const [file, pm] of LOCKFILES) {
        if (existsSync(join(cwd, file))) return pm;
    }

    const userAgent = process.env.npm_config_user_agent ?? '';
    if (userAgent.startsWith('pnpm')) return 'pnpm';
    if (userAgent.startsWith('yarn')) return 'yarn';
    if (userAgent.startsWith('bun')) return 'bun';
    if (userAgent.startsWith('npm')) return 'npm';

    return null;
}

export const PACKAGE_MANAGERS: readonly PackageManager[] = ['pnpm', 'npm', 'yarn', 'bun'] as const;

export function isPackageManager(v: unknown): v is PackageManager {
    return typeof v === 'string' && (PACKAGE_MANAGERS as readonly string[]).includes(v);
}

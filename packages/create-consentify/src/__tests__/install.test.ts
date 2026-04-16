import { afterEach, describe, expect, it, vi } from 'vitest';
import { installDeps } from '../install.js';

vi.mock('execa', () => ({
    execa: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

const { execa } = await import('execa');

afterEach(() => {
    vi.mocked(execa).mockClear();
});

describe('installDeps', () => {
    it('uses "pnpm add" for pnpm', async () => {
        await installDeps({ cwd: '/tmp', pm: 'pnpm', runtime: ['@consentify/core'] });
        expect(execa).toHaveBeenCalledWith(
            'pnpm',
            ['add', '@consentify/core'],
            expect.objectContaining({ cwd: '/tmp' }),
        );
    });

    it('uses "npm install --save" for npm', async () => {
        await installDeps({ cwd: '/tmp', pm: 'npm', runtime: ['@consentify/core'] });
        expect(execa).toHaveBeenCalledWith(
            'npm',
            ['install', '--save', '@consentify/core'],
            expect.objectContaining({ cwd: '/tmp' }),
        );
    });

    it('uses "yarn add" for yarn', async () => {
        await installDeps({ cwd: '/tmp', pm: 'yarn', runtime: ['@consentify/core'] });
        expect(execa).toHaveBeenCalledWith(
            'yarn',
            ['add', '@consentify/core'],
            expect.objectContaining({ cwd: '/tmp' }),
        );
    });

    it('uses "bun add" for bun', async () => {
        await installDeps({ cwd: '/tmp', pm: 'bun', runtime: ['@consentify/core'] });
        expect(execa).toHaveBeenCalledWith(
            'bun',
            ['add', '@consentify/core'],
            expect.objectContaining({ cwd: '/tmp' }),
        );
    });

    it('is a no-op when runtime is empty', async () => {
        await installDeps({ cwd: '/tmp', pm: 'npm', runtime: [] });
        expect(execa).not.toHaveBeenCalled();
    });

    it('propagates all runtime packages as arguments', async () => {
        await installDeps({
            cwd: '/tmp',
            pm: 'pnpm',
            runtime: ['@consentify/core', '@consentify/react'],
        });
        expect(execa).toHaveBeenCalledWith(
            'pnpm',
            ['add', '@consentify/core', '@consentify/react'],
            expect.any(Object),
        );
    });

    it('propagates execa errors to the caller', async () => {
        vi.mocked(execa).mockRejectedValueOnce(new Error('ENOENT: pnpm not found'));
        await expect(
            installDeps({ cwd: '/tmp', pm: 'pnpm', runtime: ['@consentify/core'] }),
        ).rejects.toThrow(/pnpm not found/);
    });
});

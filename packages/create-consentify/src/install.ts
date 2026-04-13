import { execa } from 'execa';
import type { PackageManager } from './detect/package-manager.js';
import { log } from './logger.js';

interface InstallOptions {
    cwd: string;
    pm: PackageManager;
    runtime: string[];
}

const COMMANDS: Record<PackageManager, { bin: string; add: string[] }> = {
    pnpm: { bin: 'pnpm', add: ['add'] },
    npm: { bin: 'npm', add: ['install', '--save'] },
    yarn: { bin: 'yarn', add: ['add'] },
    bun: { bin: 'bun', add: ['add'] },
};

export async function installDeps({ cwd, pm, runtime }: InstallOptions): Promise<void> {
    if (runtime.length === 0) return;
    const cmd = COMMANDS[pm];
    const args = [...cmd.add, ...runtime];
    log.step(`${cmd.bin} ${args.join(' ')}`);
    await execa(cmd.bin, args, { cwd, stdio: 'inherit' });
}

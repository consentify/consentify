import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

export async function writeFileSafe(
    path: string,
    content: string,
    options: { overwrite?: boolean } = {},
): Promise<'written' | 'skipped'> {
    if (!options.overwrite && existsSync(path)) {
        return 'skipped';
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
    return 'written';
}

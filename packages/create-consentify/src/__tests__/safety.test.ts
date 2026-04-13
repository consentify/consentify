import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileSafe } from '../safety.js';

let dir: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cc-safety-'));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('writeFileSafe', () => {
    it('writes a new file and creates parent directories', async () => {
        const target = join(dir, 'nested/dir/file.ts');
        const result = await writeFileSafe(target, 'hello');
        expect(result).toBe('written');
        expect(readFileSync(target, 'utf8')).toBe('hello');
    });

    it('skips when file exists and overwrite is false (default)', async () => {
        const target = join(dir, 'file.ts');
        writeFileSync(target, 'original');
        const result = await writeFileSafe(target, 'new');
        expect(result).toBe('skipped');
        expect(readFileSync(target, 'utf8')).toBe('original');
    });

    it('overwrites when overwrite is true', async () => {
        const target = join(dir, 'file.ts');
        writeFileSync(target, 'original');
        const result = await writeFileSafe(target, 'new', { overwrite: true });
        expect(result).toBe('written');
        expect(readFileSync(target, 'utf8')).toBe('new');
    });
});

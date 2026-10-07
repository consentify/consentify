import { describe, expect, it } from 'vitest';
import { isComplete, normalizeFlags } from '../flags.js';

describe('normalizeFlags', () => {
    it('returns empty object when nothing provided', () => {
        expect(normalizeFlags({})).toEqual({});
    });

    it('parses framework', () => {
        expect(normalizeFlags({ framework: 'nextjs-app' })).toEqual({ framework: 'nextjs-app' });
    });

    it('throws on invalid framework', () => {
        expect(() => normalizeFlags({ framework: 'angular' })).toThrow(/Invalid --framework/);
    });

    it('parses comma-separated categories and strips necessary', () => {
        expect(normalizeFlags({ categories: 'analytics, marketing, necessary' })).toEqual({
            categories: ['analytics', 'marketing'],
        });
    });

    it('throws on empty categories list', () => {
        expect(() => normalizeFlags({ categories: '  ,  ' })).toThrow(/Invalid --categories/);
    });

    it('parses mode', () => {
        expect(normalizeFlags({ mode: 'opt-out' })).toEqual({ mode: 'opt-out' });
    });

    it('throws on invalid mode', () => {
        expect(() => normalizeFlags({ mode: 'gdpr' })).toThrow(/Invalid --mode/);
    });

    it('enables SaaS when site-id is provided', () => {
        const out = normalizeFlags({ 'site-id': 'abc' });
        expect(out.siteId).toBe('abc');
        expect(out.useSaas).toBe(true);
    });

    it('parses --public-key and enables SaaS', () => {
        expect(normalizeFlags({ 'public-key': 'pk_1' })).toEqual({ publicKey: 'pk_1', useSaas: true });
    });

    it('rejects the removed --api-key with a hint to --public-key', () => {
        expect(() => normalizeFlags({ 'api-key': 'sk_1' })).toThrow(/renamed to --public-key/);
        // citty parses `--api-key value` for an unknown flag as `true`.
        expect(() => normalizeFlags({ 'api-key': true })).toThrow(/renamed to --public-key/);
    });

    it('parses package manager', () => {
        expect(normalizeFlags({ pm: 'bun' })).toEqual({ packageManager: 'bun' });
    });

    it('throws on invalid package manager', () => {
        expect(() => normalizeFlags({ pm: 'cargo' })).toThrow(/Invalid --pm/);
    });

    it('carries --yes through', () => {
        expect(normalizeFlags({ yes: true }).yes).toBe(true);
    });
});

describe('isComplete', () => {
    it('is false without required flags', () => {
        expect(isComplete({})).toBe(false);
        expect(isComplete({ framework: 'nextjs-app' })).toBe(false);
    });

    it('is true with all required flags for standalone', () => {
        expect(
            isComplete({
                framework: 'nextjs-app',
                categories: ['analytics'],
                mode: 'opt-in',
                packageManager: 'pnpm',
            }),
        ).toBe(true);
    });

    it('is false when SaaS enabled but no siteId', () => {
        expect(
            isComplete({
                framework: 'nextjs-app',
                categories: ['analytics'],
                mode: 'opt-in',
                packageManager: 'pnpm',
                useSaas: true,
            }),
        ).toBe(false);
    });

    it('is true when SaaS enabled with siteId', () => {
        expect(
            isComplete({
                framework: 'nextjs-app',
                categories: ['analytics'],
                mode: 'opt-in',
                packageManager: 'pnpm',
                useSaas: true,
                siteId: 'abc',
            }),
        ).toBe(true);
    });
});

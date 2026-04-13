import { describe, expect, it } from 'vitest';
import { generateConsentConfig } from '../templates/consent-config.js';
import { generateVanillaConfig } from '../templates/vanilla-config.js';
import { generateEnvExample } from '../templates/env-example.js';
import type { TemplateContext } from '../templates/types.js';
import type { Framework } from '../detect/project.js';

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

describe('generateConsentConfig', () => {
    it('emits minimal opt-in config without GCM or SaaS', () => {
        const out = generateConsentConfig(ctx());
        expect(out).toContain(`import { createConsentify } from '@consentify/core';`);
        expect(out).not.toContain(`enableConsentMode`);
        expect(out).not.toContain(`enableCloud`);
        expect(out).toContain(`mode: 'opt-in'`);
        expect(out).toContain(`categories: ['analytics', 'marketing']`);
    });

    it('emits opt-out when selected', () => {
        const out = generateConsentConfig(ctx({ mode: 'opt-out' }));
        expect(out).toContain(`mode: 'opt-out'`);
    });

    it('wires GCM without any defaults option (SDK does not accept defaults)', () => {
        const out = generateConsentConfig(ctx({ enableGcm: true }));
        expect(out).toContain(`import { createConsentify, enableConsentMode } from '@consentify/core';`);
        expect(out).toContain(`enableConsentMode(consent, {`);
        expect(out).toContain(`mapping: {`);
        expect(out).toContain(`analytics: ['analytics_storage']`);
        expect(out).toContain(`marketing: ['ad_storage', 'ad_user_data', 'ad_personalization']`);
        expect(out).not.toMatch(/defaults\s*:/);
    });

    it('wires SaaS with Next.js-style env prefix', () => {
        const out = generateConsentConfig(ctx({ useSaas: true, siteId: 'site_abc' }));
        expect(out).toContain(`import { enableCloud } from '@consentify/cloud';`);
        expect(out).toContain(`enableCloud(consent, {`);
        expect(out).toContain(`process.env.NEXT_PUBLIC_CONSENTIFY_SITE_ID!`);
        expect(out).toContain(`typeof window !== 'undefined'`);
    });

    it('uses VITE_ prefix for vite-react', () => {
        const out = generateConsentConfig(ctx({ framework: 'vite-react', useSaas: true }));
        expect(out).toContain(`process.env.VITE_CONSENTIFY_SITE_ID!`);
    });

    it('uses PUBLIC_ prefix for astro', () => {
        const out = generateConsentConfig(ctx({ framework: 'astro', useSaas: true }));
        expect(out).toContain(`process.env.PUBLIC_CONSENTIFY_SITE_ID!`);
    });

    it('uses bare CONSENTIFY_SITE_ID (no prefix) for remix', () => {
        const out = generateConsentConfig(ctx({ framework: 'remix', useSaas: true }));
        expect(out).toContain(`process.env.CONSENTIFY_SITE_ID!`);
        expect(out).not.toContain(`NEXT_PUBLIC_`);
        expect(out).not.toContain(`VITE_`);
        expect(out).not.toContain(`PUBLIC_CONSENTIFY`);
    });

    it('never references the incorrect "pending" decision state', () => {
        const matrix: TemplateContext[] = [];
        const frameworks: Framework[] = ['nextjs-app', 'vite-react', 'astro', 'remix'];
        for (const framework of frameworks) {
            for (const enableGcm of [true, false]) {
                for (const useSaas of [true, false]) {
                    matrix.push(ctx({ framework, enableGcm, useSaas }));
                }
            }
        }
        for (const c of matrix) {
            const out = generateConsentConfig(c);
            expect(out, `framework=${c.framework} gcm=${c.enableGcm} saas=${c.useSaas}`).not.toContain("'pending'");
        }
    });
});

describe('generateVanillaConfig', () => {
    it('uses hardcoded siteId, not env vars', () => {
        const out = generateVanillaConfig(ctx({
            framework: 'vanilla',
            useSaas: true,
            siteId: 'site_xyz',
        }));
        expect(out).toContain(`siteId: 'site_xyz'`);
        expect(out).not.toContain(`process.env`);
    });

    it('checks decision against unset, not pending', () => {
        const out = generateVanillaConfig(ctx({ framework: 'vanilla' }));
        expect(out).toContain("state.decision === 'unset'");
        expect(out).not.toContain("'pending'");
    });
});

describe('generateEnvExample', () => {
    it('returns null for standalone setup', () => {
        expect(generateEnvExample(ctx())).toBeNull();
    });

    it('emits Next.js-style keys when SaaS enabled', () => {
        const out = generateEnvExample(ctx({ useSaas: true, siteId: 'abc', apiKey: 'sk_1' }));
        expect(out).toContain('NEXT_PUBLIC_CONSENTIFY_SITE_ID=abc');
        expect(out).toContain('NEXT_PUBLIC_CONSENTIFY_API_KEY=sk_1');
    });

    it('emits bare keys for remix (no env prefix)', () => {
        const out = generateEnvExample(ctx({ framework: 'remix', useSaas: true, siteId: 'r' }));
        expect(out).toContain('CONSENTIFY_SITE_ID=r');
        expect(out).not.toContain('NEXT_PUBLIC_');
    });
});

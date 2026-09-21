import { describe, expect, it } from 'vitest';
import {
    generateReactProvider,
    type ProviderFlavor,
} from '../templates/consent-provider.js';

const flavors: ProviderFlavor[] = ['nextjs-app', 'nextjs-pages', 'vite-react', 'remix'];

describe('generateReactProvider', () => {
    it.each(flavors)(`%s: imports useConsentify from @consentify/react`, (flavor) => {
        const out = generateReactProvider(flavor);
        expect(out).toContain(`import { useConsentify } from '@consentify/react';`);
    });

    it.each(flavors)(`%s: wires acceptAll and rejectAll buttons (typo-resistant)`, (flavor) => {
        const out = generateReactProvider(flavor);
        expect(out).toMatch(/consent\.\s*acceptAll\s*\(\s*\)/);
        expect(out).toMatch(/consent\.\s*rejectAll\s*\(\s*\)/);
    });

    it.each(flavors)(`%s: checks decision against 'unset' not 'pending'`, (flavor) => {
        const out = generateReactProvider(flavor);
        expect(out).toContain(`state.decision === 'unset'`);
        expect(out).not.toContain(`'pending'`);
    });

    it.each(flavors)(`%s: hides the dialog until mount so SSR does not paint it`, (flavor) => {
        const out = generateReactProvider(flavor);
        expect(out).toContain(`import { useEffect, useState } from 'react';`);
        expect(out).toContain(`useState(false)`);
        expect(out).toContain(`mounted && state.decision === 'unset'`);
    });

    it(`nextjs-app: emits 'use client' directive at the top`, () => {
        const out = generateReactProvider('nextjs-app');
        expect(out.startsWith("'use client';")).toBe(true);
    });

    it.each(['nextjs-pages', 'vite-react', 'remix'] as const)(
        `%s: does NOT emit 'use client' directive`,
        (flavor) => {
            const out = generateReactProvider(flavor);
            expect(out).not.toContain("'use client'");
        },
    );

    it.each(['nextjs-app', 'nextjs-pages'] as const)(
        `%s: uses @/lib/consent path alias`,
        (flavor) => {
            const out = generateReactProvider(flavor);
            expect(out).toContain(`from '@/lib/consent'`);
        },
    );

    it.each(['vite-react', 'remix'] as const)(
        `%s: uses relative ../lib/consent import`,
        (flavor) => {
            const out = generateReactProvider(flavor);
            expect(out).toContain(`from '../lib/consent'`);
        },
    );
});

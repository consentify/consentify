import { describe, expect, it } from 'vitest';
import { formatGcmMapping } from '../templates/gcm-mapping.js';

describe('formatGcmMapping', () => {
    it('maps analytics', () => {
        expect(formatGcmMapping(['analytics'])).toContain(`analytics: ['analytics_storage']`);
    });

    it('maps marketing to three ad-related keys', () => {
        const out = formatGcmMapping(['marketing']);
        expect(out).toContain(`marketing: ['ad_storage', 'ad_user_data', 'ad_personalization']`);
    });

    it('maps preferences', () => {
        expect(formatGcmMapping(['preferences'])).toContain(`preferences: ['personalization_storage']`);
    });

    it('maps functional', () => {
        expect(formatGcmMapping(['functional'])).toContain(`functional: ['functionality_storage']`);
    });

    it('preserves category order', () => {
        const out = formatGcmMapping(['marketing', 'analytics']);
        expect(out.indexOf('marketing')).toBeLessThan(out.indexOf('analytics'));
    });

    it('falls back to a comment when no known categories are present', () => {
        expect(formatGcmMapping(['custom'])).toContain('// Add mappings for your categories');
        expect(formatGcmMapping([])).toContain('// Add mappings for your categories');
    });

    it('ignores unknown categories in a mixed list', () => {
        const out = formatGcmMapping(['custom', 'analytics']);
        expect(out).toContain(`analytics: ['analytics_storage']`);
        expect(out).not.toContain('custom:');
    });

    it('respects custom indentation', () => {
        const out = formatGcmMapping(['analytics'], '  ');
        expect(out.startsWith('  analytics:')).toBe(true);
    });
});

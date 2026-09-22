import { describe, expect, it } from 'vitest';
import { gcmDefaultScript } from '../templates/gcm-default-script.js';

function defaultsBlock(script: string): string {
    const match = script.match(/gtag\('consent', 'default', \{([\s\S]*?)\}\);/);
    return match?.[1] ?? '';
}

describe('gcmDefaultScript', () => {
    it('denies the selected categories and keeps security_storage granted', () => {
        const block = defaultsBlock(gcmDefaultScript(['analytics', 'marketing'], 'opt-in'));
        expect(block).toContain(`analytics_storage: 'denied'`);
        expect(block).toContain(`ad_storage: 'denied'`);
        expect(block).toContain(`ad_user_data: 'denied'`);
        expect(block).toContain(`ad_personalization: 'denied'`);
        expect(block).toContain(`security_storage: 'granted'`);
        expect(block).toContain(`wait_for_update: 500`);
        expect(block).not.toContain('functionality_storage');
        expect(block).not.toContain('personalization_storage');
    });

    it('grants selected categories in opt-out mode', () => {
        const block = defaultsBlock(gcmDefaultScript(['analytics', 'functional'], 'opt-out'));
        expect(block).toContain(`analytics_storage: 'granted'`);
        expect(block).toContain(`functionality_storage: 'granted'`);
        expect(block).toContain(`security_storage: 'granted'`);
    });

    it('follows preferences and functional separately', () => {
        const preferences = defaultsBlock(gcmDefaultScript(['preferences'], 'opt-in'));
        expect(preferences).toContain(`personalization_storage: 'denied'`);
        expect(preferences).not.toContain('functionality_storage');

        const functional = defaultsBlock(gcmDefaultScript(['functional'], 'opt-in'));
        expect(functional).toContain(`functionality_storage: 'denied'`);
        expect(functional).not.toContain('personalization_storage');
    });

    it('keeps category order and skips unknown categories', () => {
        const block = defaultsBlock(gcmDefaultScript(['marketing', 'custom', 'analytics'], 'opt-in'));
        expect(block.indexOf('ad_storage')).toBeLessThan(block.indexOf('analytics_storage'));
        expect(block).not.toContain('custom');
    });

    it('still emits a default when no category maps to Google', () => {
        const block = defaultsBlock(gcmDefaultScript(['custom'], 'opt-in'));
        expect(block).toContain(`security_storage: 'granted'`);
        expect(block).toContain(`wait_for_update: 500`);
        expect(block).not.toContain('analytics_storage');
    });
});

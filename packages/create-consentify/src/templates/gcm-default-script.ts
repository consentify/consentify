import { CATEGORY_TO_GOOGLE } from './gcm-mapping.js';
import type { ConsentMode } from './types.js';

/**
 * Head snippet that sends Google's consent default once, before tags run.
 * Types come from the same category map as the generated `enableConsentMode`
 * call. Opt-in denies those types; opt-out grants them. `security_storage`
 * stays granted — it is the necessary type, not a user category.
 */
export function gcmDefaultScript(
    categories: readonly string[] = [],
    mode: ConsentMode = 'opt-in',
): string {
    const choice = mode === 'opt-out' ? 'granted' : 'denied';
    const seen = new Set<string>();
    const lines: string[] = [];

    for (const category of categories) {
        const types = CATEGORY_TO_GOOGLE[category];
        if (!types) continue;
        for (const type of types) {
            if (seen.has(type)) continue;
            seen.add(type);
            lines.push(`    ${type}: '${choice}',`);
        }
    }

    if (!seen.has('security_storage')) {
        lines.push(`    security_storage: 'granted',`);
    }
    lines.push(`    wait_for_update: 500,`);

    return `<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('consent', 'default', {
${lines.join('\n')}
  });
</script>`;
}

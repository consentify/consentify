const CATEGORY_TO_GOOGLE: Record<string, readonly string[]> = {
    analytics: ['analytics_storage'],
    marketing: ['ad_storage', 'ad_user_data', 'ad_personalization'],
    preferences: ['personalization_storage'],
    functional: ['functionality_storage'],
};

export function formatGcmMapping(categories: readonly string[], indent = '        '): string {
    const known = categories.filter((c) => c in CATEGORY_TO_GOOGLE);
    if (known.length === 0) {
        return `${indent}// Add mappings for your categories -> Google consent types`;
    }
    return known
        .map((c) => {
            const values = CATEGORY_TO_GOOGLE[c].map((v) => `'${v}'`).join(', ');
            return `${indent}${c}: [${values}],`;
        })
        .join('\n');
}

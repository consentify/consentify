import { defineCommand } from 'citty';
import { FRAMEWORKS, isFramework, type Framework } from './detect/project.js';
import { PACKAGE_MANAGERS, isPackageManager, type PackageManager } from './detect/package-manager.js';
import type { ConsentMode } from './templates/types.js';

export interface ParsedFlags {
    framework?: Framework;
    categories?: string[];
    mode?: ConsentMode;
    enableGcm?: boolean;
    useSaas?: boolean;
    siteId?: string;
    apiKey?: string;
    packageManager?: PackageManager;
    cwd?: string;
    yes?: boolean;
}

export interface FlagInput {
    framework?: string;
    categories?: string;
    mode?: string;
    gcm?: boolean;
    'site-id'?: string;
    'api-key'?: string;
    pm?: string;
    cwd?: string;
    yes?: boolean;
}

export function normalizeFlags(raw: FlagInput): ParsedFlags {
    const out: ParsedFlags = {};

    if (raw.framework !== undefined) {
        if (!isFramework(raw.framework)) {
            throw new Error(
                `Invalid --framework: '${raw.framework}'. Valid: ${FRAMEWORKS.join(', ')}.`,
            );
        }
        out.framework = raw.framework;
    }

    if (raw.categories !== undefined) {
        const parts = raw.categories
            .split(',')
            .map((c) => c.trim())
            .filter((c) => c.length > 0 && c !== 'necessary');
        if (parts.length === 0) {
            throw new Error(`Invalid --categories: must be a non-empty comma-separated list.`);
        }
        out.categories = parts;
    }

    if (raw.mode !== undefined) {
        if (raw.mode !== 'opt-in' && raw.mode !== 'opt-out') {
            throw new Error(`Invalid --mode: '${raw.mode}'. Valid: opt-in, opt-out.`);
        }
        out.mode = raw.mode;
    }

    if (raw.gcm !== undefined) out.enableGcm = raw.gcm;

    if (raw['site-id'] !== undefined) {
        out.siteId = raw['site-id'];
        out.useSaas = true;
    }
    if (raw['api-key'] !== undefined) {
        out.apiKey = raw['api-key'];
        out.useSaas = true;
    }

    if (raw.pm !== undefined) {
        if (!isPackageManager(raw.pm)) {
            throw new Error(
                `Invalid --pm: '${raw.pm}'. Valid: ${PACKAGE_MANAGERS.join(', ')}.`,
            );
        }
        out.packageManager = raw.pm;
    }

    if (raw.cwd !== undefined) out.cwd = raw.cwd;
    if (raw.yes !== undefined) out.yes = raw.yes;

    return out;
}

export function isComplete(flags: ParsedFlags): boolean {
    if (!flags.framework || !flags.mode || !flags.categories || flags.categories.length === 0) {
        return false;
    }
    if (!flags.packageManager) return false;
    if (flags.useSaas && !flags.siteId) return false;
    return true;
}

export const command = defineCommand({
    meta: {
        name: 'create-consentify',
        version: '0.1.0',
        description: 'Scaffold Consentify cookie consent SDK into your project.',
    },
    args: {
        framework: {
            type: 'string',
            description: `Framework to scaffold (${FRAMEWORKS.join(' | ')}).`,
        },
        categories: {
            type: 'string',
            description: 'Comma-separated consent categories (e.g. analytics,marketing).',
        },
        mode: {
            type: 'string',
            description: 'Consent mode: opt-in (GDPR) or opt-out (CCPA).',
        },
        gcm: {
            type: 'boolean',
            description: 'Enable Google Consent Mode v2 wiring.',
        },
        'site-id': {
            type: 'string',
            description: 'Consentify dashboard Site ID (enables SaaS mode).',
        },
        'api-key': {
            type: 'string',
            description: 'Consentify dashboard API key (optional).',
        },
        pm: {
            type: 'string',
            description: `Package manager to install deps with (${PACKAGE_MANAGERS.join(' | ')}).`,
        },
        cwd: {
            type: 'string',
            description: 'Target project directory (defaults to process.cwd()).',
        },
        yes: {
            type: 'boolean',
            description: 'Skip prompts when all required flags are provided.',
        },
    },
});

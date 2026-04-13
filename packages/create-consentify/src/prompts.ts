import {
    cancel,
    confirm,
    group,
    intro,
    isCancel,
    multiselect,
    outro,
    select,
    text,
} from '@clack/prompts';
import { FRAMEWORKS, type Framework } from './detect/project.js';
import { PACKAGE_MANAGERS, type PackageManager } from './detect/package-manager.js';
import { FRAMEWORK_REGISTRY } from './frameworks/index.js';
import { pc } from './logger.js';
import type { ConsentMode } from './templates/types.js';

export interface PromptResult {
    framework: Framework;
    categories: string[];
    mode: ConsentMode;
    enableGcm: boolean;
    useSaas: boolean;
    siteId?: string;
    apiKey?: string;
    packageManager: PackageManager;
}

export interface PromptHints {
    framework?: Framework;
    categories?: string[];
    mode?: ConsentMode;
    enableGcm?: boolean;
    useSaas?: boolean;
    siteId?: string;
    apiKey?: string;
    packageManager?: PackageManager;
    detectedPm?: PackageManager;
    detectedFramework?: Framework;
}

function bail(reason = 'Aborted.'): never {
    cancel(reason);
    process.exit(130);
}

function guard<T>(value: T | symbol): T {
    if (isCancel(value)) bail();
    return value as T;
}

export async function runWizard(hints: PromptHints = {}): Promise<PromptResult> {
    intro(pc.bgCyan(pc.black(' create-consentify ')));

    const framework = guard(
        await select({
            message: hints.detectedFramework
                ? `Framework? ${pc.dim(`(detected: ${hints.detectedFramework})`)}`
                : 'Which framework?',
            initialValue: hints.framework ?? hints.detectedFramework ?? 'nextjs-app',
            options: FRAMEWORKS.map((id) => ({
                value: id,
                label: FRAMEWORK_REGISTRY[id].label,
            })),
        }),
    ) as Framework;

    const categories = guard(
        await multiselect({
            message: pc.dim('(necessary is always included)') + ' Which consent categories?',
            required: true,
            initialValues: hints.categories ?? ['analytics', 'marketing'],
            options: [
                { value: 'analytics', label: 'analytics' },
                { value: 'marketing', label: 'marketing' },
                { value: 'preferences', label: 'preferences' },
                { value: 'functional', label: 'functional' },
            ],
        }),
    ) as string[];

    const mode = guard(
        await select({
            message: 'Which consent mode?',
            initialValue: hints.mode ?? 'opt-in',
            options: [
                { value: 'opt-in', label: 'opt-in (GDPR, recommended for EU)' },
                { value: 'opt-out', label: 'opt-out (CCPA)' },
            ],
        }),
    ) as ConsentMode;

    const enableGcm = guard(
        await confirm({
            message: 'Enable Google Consent Mode v2? (recommended if using GA/GTM)',
            initialValue: hints.enableGcm ?? true,
        }),
    ) as boolean;

    const useSaas = guard(
        await confirm({
            message: 'Connect to Consentify dashboard? (analytics, visual editor)',
            initialValue: hints.useSaas ?? false,
        }),
    ) as boolean;

    let siteId: string | undefined;
    let apiKey: string | undefined;
    if (useSaas) {
        const creds = guard(
            await group(
                {
                    siteId: () =>
                        text({
                            message: 'Site ID (from dashboard.consentify.dev)',
                            placeholder: 'site_xxx',
                            initialValue: hints.siteId,
                            validate: (v) => (v && v.trim().length > 0 ? undefined : 'Site ID is required'),
                        }),
                    apiKey: () =>
                        text({
                            message: 'API Key (optional)',
                            placeholder: 'sk_xxx',
                            initialValue: hints.apiKey,
                        }),
                },
                { onCancel: () => bail() },
            ),
        ) as { siteId: string; apiKey: string };
        siteId = creds.siteId.trim();
        apiKey = creds.apiKey?.trim() || undefined;
    }

    const packageManager = guard(
        await select({
            message: hints.detectedPm
                ? `Package manager? ${pc.dim(`(detected: ${hints.detectedPm})`)}`
                : 'Which package manager?',
            initialValue: hints.packageManager ?? hints.detectedPm ?? 'npm',
            options: PACKAGE_MANAGERS.map((pm) => ({ value: pm, label: pm })),
        }),
    ) as PackageManager;

    outro(pc.green('Ready to scaffold.'));

    return {
        framework,
        categories,
        mode,
        enableGcm,
        useSaas,
        siteId,
        apiKey,
        packageManager,
    };
}

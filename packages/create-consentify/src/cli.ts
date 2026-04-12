import { resolve } from 'node:path';
import { detectFrameworkHint, detectSrcDir } from './detect/project.js';
import { detectPackageManager } from './detect/package-manager.js';
import { isComplete, type ParsedFlags } from './flags.js';
import { FRAMEWORK_REGISTRY } from './frameworks/index.js';
import { installDeps } from './install.js';
import { log, pc } from './logger.js';
import { runWizard, type PromptResult } from './prompts.js';
import { writeFileSafe } from './safety.js';
import { gcmDefaultScript } from './templates/gcm-default-script.js';
import type { TemplateContext } from './templates/types.js';

export async function run(flags: ParsedFlags = {}): Promise<void> {
    const cwd = resolve(flags.cwd ?? process.cwd());
    const detectedPm = detectPackageManager(cwd);
    const detectedFramework = detectFrameworkHint(cwd);

    const answers = await resolveAnswers(flags, cwd, detectedPm, detectedFramework);

    const ctx: TemplateContext = {
        framework: answers.framework,
        categories: answers.categories,
        mode: answers.mode,
        enableGcm: answers.enableGcm,
        useSaas: answers.useSaas,
        siteId: answers.siteId,
        apiKey: answers.apiKey,
        srcDir: detectSrcDir(cwd),
    };

    const scaffolder = FRAMEWORK_REGISTRY[ctx.framework];
    const files = scaffolder.files(ctx);
    const runtime = scaffolder.runtimeDeps(ctx, cwd);

    console.log();
    log.info(pc.bold(`Installing dependencies with ${answers.packageManager}:`));
    try {
        await installDeps({ cwd, pm: answers.packageManager, runtime });
    } catch (err) {
        log.error(
            `Install failed. You can retry manually: ${answers.packageManager} add ${runtime.join(' ')}`,
        );
        throw err;
    }

    console.log();
    log.info(pc.bold('Writing files:'));
    let written = 0;
    let skipped = 0;
    for (const file of files) {
        const abs = resolve(cwd, file.path);
        const result = await writeFileSafe(abs, file.content, { overwrite: false });
        if (result === 'written') {
            log.success(file.path);
            written++;
        } else {
            log.warn(`${file.path} already exists - skipped`);
            skipped++;
        }
    }

    if (written === 0 && skipped > 0) {
        console.log();
        log.error(
            `No files were written (${skipped} already exist). Remove them or run in a fresh directory to scaffold.`,
        );
        process.exit(1);
    }

    console.log();
    log.success(pc.bold('Done!'));
    console.log();
    log.info(pc.bold('Next steps:'));
    for (const line of scaffolder.instructions(ctx)) {
        console.log('  ' + line);
    }

    if (ctx.enableGcm) {
        console.log();
        log.info(pc.bold('Google Consent Mode v2 default state (add to <head> BEFORE any GA/GTM):'));
        console.log();
        for (const line of gcmDefaultScript().split('\n')) {
            console.log('  ' + pc.dim(line));
        }
    }

    console.log();
    log.dim('Docs: https://consentify.dev/docs');
}

async function resolveAnswers(
    flags: ParsedFlags,
    cwd: string,
    detectedPm: ReturnType<typeof detectPackageManager>,
    detectedFramework: ReturnType<typeof detectFrameworkHint>,
): Promise<PromptResult> {
    if (flags.yes) {
        const merged: ParsedFlags = {
            ...flags,
            packageManager: flags.packageManager ?? detectedPm ?? undefined,
        };
        if (!isComplete(merged)) {
            throw new Error(
                '--yes was passed but required flags are missing. Provide --framework, --categories, --mode, and --pm (or run in a project with a lockfile). If --site-id is set, it is also required.',
            );
        }
        return {
            framework: merged.framework!,
            categories: merged.categories!,
            mode: merged.mode!,
            enableGcm: merged.enableGcm ?? false,
            useSaas: merged.useSaas ?? false,
            siteId: merged.siteId,
            apiKey: merged.apiKey,
            packageManager: merged.packageManager!,
        };
    }

    if (detectedFramework) {
        log.dim(`Detected ${detectedFramework} in ${cwd}`);
    }

    return runWizard({
        framework: flags.framework,
        categories: flags.categories,
        mode: flags.mode,
        enableGcm: flags.enableGcm,
        useSaas: flags.useSaas,
        siteId: flags.siteId,
        apiKey: flags.apiKey,
        packageManager: flags.packageManager ?? detectedPm ?? undefined,
        detectedPm: detectedPm ?? undefined,
        detectedFramework: detectedFramework ?? undefined,
    });
}

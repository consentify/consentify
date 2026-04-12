import type { Framework } from '../detect/project.js';
import type { TemplateContext } from '../templates/types.js';

export interface GeneratedFile {
    path: string;
    content: string;
}

export interface FrameworkScaffolder {
    readonly id: Framework;
    readonly label: string;
    files(ctx: TemplateContext): GeneratedFile[];
    runtimeDeps(ctx: TemplateContext, cwd?: string): string[];
    instructions(ctx: TemplateContext): string[];
}

import pc from 'picocolors';

export const log = {
    info: (msg: string) => console.log(pc.cyan('info'), msg),
    success: (msg: string) => console.log(pc.green('✓'), msg),
    warn: (msg: string) => console.warn(pc.yellow('!'), msg),
    error: (msg: string) => console.error(pc.red('✗'), msg),
    dim: (msg: string) => console.log(pc.dim(msg)),
    step: (msg: string) => console.log(pc.cyan('→'), msg),
};

export { pc };

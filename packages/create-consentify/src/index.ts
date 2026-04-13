import { runMain } from 'citty';
import { run } from './cli.js';
import { command, normalizeFlags, type FlagInput } from './flags.js';
import { log } from './logger.js';

const main = {
    ...command,
    async run({ args }: { args: FlagInput }) {
        try {
            const flags = normalizeFlags(args);
            await run(flags);
        } catch (err) {
            if (err instanceof Error) {
                log.error(err.message);
            } else {
                log.error(String(err));
            }
            process.exit(1);
        }
    },
};

runMain(main);

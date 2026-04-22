import type { ConsentEventHandler, ConsentEventMap, UserCategory } from './types';
import { TAG } from './util';

export interface EnableDebugOptions<T extends UserCategory = UserCategory> {
    onLog?: (message: string, event: ConsentEventMap<T>[keyof ConsentEventMap<T>]) => void;
}

export function enableDebug<T extends UserCategory>(
    instance: { on: <K extends keyof ConsentEventMap<T>>(type: K, handler: ConsentEventHandler<T, K>) => () => void },
    options?: EnableDebugOptions<T>,
): () => void {
    const log = options?.onLog ?? ((msg: string, event: unknown) => console.log(TAG + msg, event));
    const unsub1 = instance.on('change', (e) => log('Consent changed', e));
    const unsub2 = instance.on('clear', (e) => log('Consent cleared', e));
    const unsub3 = instance.on('expiring', (e) => log('Consent expiring', e));
    return () => { unsub1(); unsub2(); unsub3(); };
}

export const DEFAULT_COOKIE = 'consentify';

export type CookieOpt = {
    maxAgeSec: number;
    sameSite: 'Lax' | 'Strict' | 'None';
    secure: boolean;
    path: string;
    domain?: string;
};

export function buildSetCookieHeader(name: string, value: string, opt: CookieOpt): string {
    let h = `${name}=${value}; Path=${opt.path}; Max-Age=${opt.maxAgeSec}; SameSite=${opt.sameSite}`;
    if (opt.domain) h += `; Domain=${opt.domain}`;
    if (opt.secure) h += `; Secure`;
    return h;
}

export function readCookie(name: string, cookieStr?: string): string | null {
    const src = cookieStr ?? (typeof document !== 'undefined' ? document.cookie : '');
    if (!src) return null;
    // Manual scan avoids allocating an array of every cookie on every read; on
    // SSR requests the Cookie header can be long and this is the hot path.
    const needle = name + '=';
    let i = 0;
    while (i < src.length) {
        // Skip leading whitespace after a ';' boundary.
        while (i < src.length && (src[i] === ' ' || src[i] === '\t')) i++;
        if (src.startsWith(needle, i)) {
            const start = i + needle.length;
            const end = src.indexOf(';', start);
            return end === -1 ? src.slice(start) : src.slice(start, end);
        }
        const next = src.indexOf(';', i);
        if (next === -1) break;
        i = next + 1;
    }
    return null;
}

export function writeCookie(name: string, value: string, opt: CookieOpt): void {
    if (typeof document === 'undefined') return;
    document.cookie = buildSetCookieHeader(name, value, opt);
}

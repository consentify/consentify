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
    const m = src.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='));
    return m ? m.slice(name.length + 1) : null;
}

export function writeCookie(name: string, value: string, opt: CookieOpt): void {
    if (typeof document === 'undefined') return;
    document.cookie = buildSetCookieHeader(name, value, opt);
}

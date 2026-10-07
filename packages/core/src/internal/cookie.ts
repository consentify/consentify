export const DEFAULT_COOKIE = 'consentify';

export type CookieOpt = {
    maxAgeSec: number;
    sameSite: 'Lax' | 'Strict' | 'None';
    secure: boolean;
    path: string;
    domain?: string;
    partitioned?: boolean;
};

export function buildSetCookieHeader(name: string, value: string, opt: CookieOpt): string {
    let h = `${name}=${value}; Path=${opt.path}; Max-Age=${opt.maxAgeSec}; SameSite=${opt.sameSite}`;
    if (opt.domain) h += `; Domain=${opt.domain}`;
    if (opt.secure) h += `; Secure`;
    if (opt.partitioned) h += `; Partitioned`;
    return h;
}

/**
 * Splits a `Set-Cookie` header returned by the server API (`set`, `clear`,
 * `acceptAll`, `rejectAll`) into `name`, `value` and an `options` object shaped
 * for framework cookie setters (lowercase `sameSite`, `maxAge` in seconds), so
 * the instance's cookie config is applied instead of being re-typed by hand.
 * `value` is URI-decoded, ready for setters that encode values themselves
 * (Next.js, SvelteKit, Express). Written for the
 * SDK's own output (Path, Max-Age, Domain, SameSite, Secure, Partitioned);
 * kept minimal for bundle size, so other attributes pass through under their
 * lowercased name and values containing `=` are not supported.
 *
 * @example Next.js Server Action
 * const { name, value, options } = parseSetCookie(consent.acceptAll(cookieStore.toString()));
 * cookieStore.set(name, value, options);
 */
export function parseSetCookie(header: string): {
    name: string;
    value: string;
    options: { path?: string; maxAge?: number; domain?: string; sameSite?: 'lax' | 'strict' | 'none'; secure?: boolean; partitioned?: boolean };
} {
    const [[name, value], ...attrs] = header.split(/; */).map(p => p.split('='));
    const options: Record<string, unknown> = {};
    for (let [k, v] of attrs) {
        k = k.toLowerCase();
        if (k === 'max-age') options.maxAge = +v;
        else if (k === 'samesite') options.sameSite = v.toLowerCase();
        else options[k] = v ?? true;
    }
    return { name, value: decodeURIComponent(value), options };
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

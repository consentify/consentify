import type { ConsentProof, UserCategory } from './types';
import { stableStringify, toHex } from './util';

export async function hmacSign(secret: string, payload: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw', enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
    return toHex(sig);
}

/**
 * Verifies an HMAC-SHA256-signed `ConsentProof`. Re-computes the signature
 * from `{policy, givenAt, choices}` using `secret` and compares to
 * `proof.signature`. Returns `false` on mismatch or on any crypto error.
 * FNV1a proofs (the deprecated fallback) will not verify here.
 */
export async function verifyProof<T extends UserCategory>(
    proof: ConsentProof<T>,
    secret: string,
): Promise<boolean> {
    try {
        const body = { policy: proof.policy, givenAt: proof.givenAt, choices: proof.choices };
        const expected = await hmacSign(secret, stableStringify(body));
        return expected === proof.signature;
    } catch {
        return false;
    }
}

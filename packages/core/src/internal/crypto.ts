import type { ConsentProof, Snapshot, UserCategory } from './types';
import { fnv1a, stableStringify, toHex } from './util';

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

// Canonical body picked by both proof builders and `verifyProof`. Keep the key
// order stable — `stableStringify` re-sorts, but keeping the source consistent
// makes intent obvious.
const proofBody = <T extends UserCategory>(s: Pick<Snapshot<T>, 'policy' | 'givenAt' | 'choices'>) =>
    ({ policy: s.policy, givenAt: s.givenAt, choices: s.choices });

/** Deprecated FNV1a proof (forgeable). Used only when no `secret` is supplied. */
export function buildProofFnv1a<T extends UserCategory>(snapshot: Snapshot<T>): ConsentProof<T> {
    const body = proofBody(snapshot);
    return { ...body, signature: fnv1a(stableStringify(body)) };
}

/** HMAC-SHA256 signed proof. Requires `secret`. */
export async function buildProofHmac<T extends UserCategory>(
    snapshot: Snapshot<T>,
    secret: string,
): Promise<ConsentProof<T>> {
    const body = proofBody(snapshot);
    const signature = await hmacSign(secret, stableStringify(body));
    return { ...body, signature };
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
        const expected = await hmacSign(secret, stableStringify(proofBody(proof)));
        return expected === proof.signature;
    } catch {
        return false;
    }
}

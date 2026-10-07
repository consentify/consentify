# Consent Record v2 Design

**Date:** 2026-10-07
**Status:** Proposed (v3 task B3)

## Problem

GDPR Art. 7(1) puts the burden of proof on the controller: it must be able to show that the user consented. Today a stored record is

```json
{ "policy": "1a2b3c4d", "givenAt": "2026-10-07T12:34:56.789Z", "choices": { "necessary": true, "analytics": true } }
```

`policy` is a hash of the category names (or `policy.identifier`). The record shows *what* was chosen and *when*, but not which policy text the user saw, in which language, or through which UI. Those are the questions an auditor asks, and the hosted platform sells the audit trail as its main feature, so the record itself has to carry the answers.

## Decision

New writes produce a version 2 record. Keys stay short because the record lives in a cookie (4 KB cap, see [Cookie size](#cookie-size)).

```ts
type ConsentSource = 'banner' | 'preferences' | 'api';

interface Snapshot<T> {
  v?: 2;               // record format; always 2 on new writes, absent on v1 records
  id?: string;         // random id of the decision; always set on new writes, absent on v1 records
  policy: string;      // policy.identifier or category hash (unchanged)
  givenAt: string;     // ISO timestamp (unchanged)
  choices: Choices<T>; // (unchanged)
  pv?: string;         // policy text version shown to the user
  lang?: string;       // language of the consent UI (BCP 47 tag)
  src?: ConsentSource; // which UI recorded the decision
}
```

Optional keys are left out of the record when unset, never written as `null` or `""`.

| Field | Source | Notes |
|-------|--------|-------|
| `v` | always `2` | Lets readers tell a v2 record without metadata from a v1 record |
| `id` | 12 random lowercase hex chars (`crypto.getRandomValues`, `Math.random` without Web Crypto) | Identity of the decision, client and server writes alike. `givenAt` has millisecond resolution, so two decisions in the same millisecond (two quick `set()` calls, or two visitors) would otherwise look identical to the reporter's dedup and to the ingest's decision merge |
| `pv` | `policy.textVersion` (init) | Recorded on every new record. Does not invalidate consent (see below) |
| `lang` | per-call `lang`, else init `lang`, else `<html lang>` | `<html lang>` is read at write time, so SPAs that switch language record the current one. Client writes only; no `navigator.language` fallback |
| `src` | per-call `source` | `'banner'` (first-layer banner), `'preferences'` (settings dialog), `'api'` (programmatic, e.g. a server route or an imported decision) |

### Write API

`set`, `acceptAll` and `rejectAll` take an optional metadata object:

```ts
consent.acceptAll({ source: 'banner' });
consent.set({ analytics: true }, { source: 'preferences', lang: 'de' });
consent.rejectAll({ cookieHeader, source: 'api' }); // server
```

This needs a change to server-mode detection. Today any non-null object as the last argument means server mode, so `set(choices, { source: 'banner' })` would go server-side and return a header instead of writing the browser store. New rule: **server mode iff `'cookieHeader' in opts`**. The value may be `undefined`, `null` or `''`, all meaning "no cookie", so `request.headers.get('cookie')` can be passed as is. `ServerOptions` becomes `{ cookieHeader: string | null | undefined }` with a required key, and server writes take `ServerOptions & WriteOptions`. `clear({})` is no longer server mode; use `clear({ cookieHeader })`. There has been no 2.x release with the object form, so this only changes v3 pre-release code.

Metadata describes one decision. A server write merges `choices` from the existing cookie, but `pv`, `lang` and `src` come only from the current call and init, never from the previous record.

A write with a `source` always produces a new record (fresh `id` and `givenAt`), even for unchanged choices: that is a re-affirmation by the user. A write without a `source` whose merged choices equal the stored record's keeps that record: in the browser nothing is written and nothing is notified or reported, and on the server the returned `Set-Cookie` re-serializes the stored record unchanged. Programmatic restores (`set(profile.choices)` on every load, `set()` in an effect that depends on consent state) therefore neither extend consent nor loop. Client writes outside a browser are ignored with a warning: on a server the instance is shared by every request.

To keep untyped callers (IIFE / script-tag sites) from writing a record that the next read rejects, writes coerce `pv` and `lang` to strings and drop an unknown `source`.

### Why `how` is not stored

"Accept all", "reject all" and "custom" are derivable from `choices` plus the policy's category list: every user category `true` is accept all, every one `false` is reject all, anything else is custom. The category list is known from `policy` (the hosted platform stores each published policy version; self-hosted users have it in code). The ingest reporter already derives `action` this way. Storing it would cost ~20 cookie bytes per record and could disagree with `choices`.

The one thing lost is telling an "Accept all" click from a custom selection that happens to grant everything. Both have the same legal effect, and `src` still tells the banner from the preferences dialog.

### `policy.textVersion` does not invalidate consent

`pv` is evidence, not a policy key. Changing `textVersion` (typo fix, new wording, translation update) records the new value on new decisions, while existing consent stays valid and keeps the `pv` the user actually saw. For a material change that needs fresh consent, bump `policy.identifier` (or change the categories), which invalidates every stored record as before.

## Reading v1 records

`isValidSnapshot` accepts:

- **v1**: no `v` key, same rules as today.
- **v2**: `v === 2`; `id`, `pv` and `lang`, when present, must be strings; `src`, when present, must be one of the three sources.

Any other `v` is rejected, so a future format needs an explicit reader instead of being misread. A v1 cookie (or adapter record) with a matching policy hash stays `decided`: upgrading the SDK forces no re-consent. It is returned as stored, without `v`, `id` or metadata, and is not rewritten on read; rewriting would invent metadata the user never saw. The next write by the user produces a v2 record. That is why `v` and `id` are optional in the `Snapshot` type even though every new record has them.

Adapter `load()` results go through the same check, so an adapter must return the record as saved (JSON round-trip is enough). Columns mapped to `null` are rejected like any other non-string value.

## Cookie size

Measured with five categories, URI-encoded as stored:

| Record | Encoded value |
|--------|---------------|
| v1 | 266 B |
| v2, `id`, no metadata | 312 B (+46) |
| v2, `id`, `pv: "2026-10-01"`, `lang: "en-US"`, `src: "preferences"` | 401 B (+135) |

The `id` costs 32 bytes encoded. The full `Set-Cookie` header for the last row is ~460 B. `encodeURIComponent` turns every `"`, `:` and `,` into three bytes, so key length counts: `pv`/`lang`/`src`/`v` instead of `textVersion`/`language`/`source`/`version` saves ~22 raw bytes per record. Values are not truncated. Keep `textVersion` short (a date or semver) and `lang` a BCP 47 tag; the existing warning at 3.5 KB still applies.

## HMAC proof

`proofBody` signs `policy`, `givenAt`, `choices` and, when present, `id`, `v`, `pv`, `lang` and `src`. `ConsentProof<T>` is `Snapshot<T> & { signature }`, so the proof carries the same optional fields. Changing, adding or removing any of them fails `verifyProof`.

A field that is absent (or `null`) is left out of the signed body. A proof issued by 2.x for a v1 record was signed over `{ policy, givenAt, choices }`; its body is unchanged, so it still verifies. Proofs for v1 records read by v3 are v1-shaped too (no `id`).

`visitorId` is not part of the proof; it stays adapter / ingest context.

## Out of scope

- Cloud wiring: SiteConfig fields for `textVersion`/`lang` and the ingest payload carrying `pv`, `lang`, `src` are a follow-up task. `createCloudConsentify` records `<html lang>` and per-call metadata until then.
- Exposing `textVersion` on `instance.policy`.

## Testing

`packages/core/src/index.test.ts`: new records have `v: 2` and a 12-hex `id` (a new one per write, also without Web Crypto) and omit unset keys; `pv` from `policy.textVersion`; `lang` from init, `<html lang>` and per-call override; `src` per call on `set` / `acceptAll` / `rejectAll`, client and server; `set(choices, { source })` stays client-side; `set(choices, { cookieHeader: undefined })` is server mode; a v1 cookie still reads as decided; invalid `src`, non-string `id` / `pv` and unknown `v` are rejected; tampering `id` or `src` fails `verifyProof`; a 2.x-style v1 proof still verifies.

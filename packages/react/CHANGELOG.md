# @consentify/react

## 3.0.0

### Major Changes

- f45e191: Server mode on the flat API is now chosen by an options object: `get({ cookieHeader })`, `isGranted(category, { cookieHeader })`, `set(choices, { cookieHeader })`, `clear({ cookieHeader })`, `acceptAll({ cookieHeader })` and `rejectAll({ cookieHeader })` replace the bare-string and `get(null)` forms. Instances without a `secret` no longer have `getProof` (the forgeable FNV1a fallback is gone), `adapter.save` no longer receives a `proof` (saves run in the browser, where `secret` is not allowed), and the deprecated `client.get(category)` is removed in favour of `isGranted(category)`. `@consentify/react` re-exports these core APIs, so it moves to a major version too; the hook itself is unchanged.

### Patch Changes

- Updated dependencies [984f099]
- Updated dependencies [28561d9]
- Updated dependencies [984f099]
- Updated dependencies [f45e191]
- Updated dependencies [f45e191]
- Updated dependencies [f45e191]
- Updated dependencies [f45e191]
- Updated dependencies [f45e191]
- Updated dependencies [f45e191]
- Updated dependencies [f45e191]
- Updated dependencies [f45e191]
- Updated dependencies [f45e191]
- Updated dependencies [f45e191]
- Updated dependencies [f45e191]
  - @consentify/core@3.0.0

## 2.1.1

### Patch Changes

- Packaging fixes: `exports` lists `types` first and adds a `default` condition (react); ship the MIT LICENSE file in the tarball (create-consentify); remove `engines.pnpm` constraint from published manifests.
- Updated dependencies
- Updated dependencies
  - @consentify/core@2.6.0

## 2.1.0

### Minor Changes

- eaaa712: Add category overload to `useConsentify` hook.

  - `useConsentify(instance)` - returns `ConsentState<T>` (unchanged)
  - `useConsentify(instance, 'analytics')` - returns `boolean` for a single category

  The category overload simplifies the most common React use case: checking if a specific consent category is granted.

### Patch Changes

- Updated dependencies [eaaa712]
  - @consentify/core@2.2.0

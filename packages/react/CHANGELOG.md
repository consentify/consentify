# @consentify/react

## 2.1.0

### Minor Changes

- eaaa712: Add category overload to `useConsentify` hook.

  - `useConsentify(instance)` - returns `ConsentState<T>` (unchanged)
  - `useConsentify(instance, 'analytics')` - returns `boolean` for a single category

  The category overload simplifies the most common React use case: checking if a specific consent category is granted.

### Patch Changes

- Updated dependencies [eaaa712]
  - @consentify/core@2.2.0

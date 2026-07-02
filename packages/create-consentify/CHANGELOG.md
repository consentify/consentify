# create-consentify

## 0.2.1

### Patch Changes

- Packaging fixes: `exports` lists `types` first and adds a `default` condition (react); ship the MIT LICENSE file in the tarball (create-consentify); remove `engines.pnpm` constraint from published manifests.

## 0.2.0

### Minor Changes

- Migrate generated SaaS setup to `@consentify/core` Mode B.

  When a user opts into the Consentify Dev integration, the scaffolder now
  emits:

  ```ts
  export const consent = await createConsentify({
    siteId: process.env.NEXT_PUBLIC_CONSENTIFY_SITE_ID!,
    apiKey: process.env.NEXT_PUBLIC_CONSENTIFY_API_KEY,
    mode: "opt-in",
  });
  ```

  instead of the previous self-hosted `createConsentify(...)` + separate
  `enableCloud(...)` call. `@consentify/cloud` is no longer added to the
  installed runtime dependencies by any framework scaffolder.

  Existing self-hosted scaffolds (no `--site-id` flag, no SaaS opt-in) are
  unaffected and continue to emit a synchronous `createConsentify({ policy,
mode })` config.

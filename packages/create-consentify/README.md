# create-consentify

Scaffold [Consentify](https://consentify.dev) cookie consent into your project in ~30 seconds.

```bash
npx create-consentify@latest
# or
pnpm create consentify
# or
bunx create-consentify
```

## What it does

Interactive wizard that:

1. Asks you which framework you're using.
2. Picks consent categories, mode (opt-in / opt-out), and optional Google Consent Mode v2 wiring.
3. Optionally connects to the Consentify dashboard (analytics, visual editor).
4. Installs `@consentify/core` (+ `@consentify/react` when relevant). Cloud reporting now lives in `@consentify/core` itself via `createConsentify({ siteId })`, so no separate cloud package is added.
5. Writes a `lib/consent.ts` and a provider component for your framework.
6. Prints the exact snippet to paste into your root layout / entry file.

It will **never** modify your existing `layout.tsx`, `_app.tsx`, `main.tsx`, or `root.tsx` - those edits are shown as instructions for you to apply.

## Supported frameworks

- Next.js (App Router)
- Next.js (Pages Router)
- Vite + React
- Remix
- Astro
- Vanilla JS / HTML

## Non-interactive (CI)

```bash
npx create-consentify@latest \
  --framework nextjs-app \
  --categories analytics,marketing \
  --mode opt-in \
  --gcm \
  --site-id site_xxx \
  --api-key sk_xxx \
  --pm pnpm \
  --yes
```

All flags are optional; any missing flag triggers a prompt (unless `--yes` is set and the combination is complete).

| Flag           | Values                                                             |
| -------------- | ------------------------------------------------------------------ |
| `--framework`  | `nextjs-app`, `nextjs-pages`, `vite-react`, `remix`, `astro`, `vanilla` |
| `--categories` | Comma-separated (e.g. `analytics,marketing`). `necessary` is implicit. |
| `--mode`       | `opt-in` (GDPR, default) \| `opt-out` (CCPA)                       |
| `--gcm`        | Enable Google Consent Mode v2 wiring                               |
| `--site-id`    | Consentify dashboard Site ID (implies SaaS mode)                   |
| `--api-key`    | Dashboard API key (optional)                                       |
| `--pm`         | `pnpm` \| `npm` \| `yarn` \| `bun`                                 |
| `--cwd`        | Target project directory (default: `process.cwd()`)                |
| `--yes`        | Skip prompts when required flags are provided                      |

## Docs

- Consentify SDK: https://consentify.dev/docs
- Source: https://github.com/consentify/consentify

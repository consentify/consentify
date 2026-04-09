# @consentify/ui

Headless React components for [@consentify/core](https://www.npmjs.com/package/@consentify/core).

## Install

```bash
npm install @consentify/core @consentify/ui
```

## ConsentGate

Conditionally render children based on consent category:

```tsx
import { ConsentGate } from '@consentify/ui';
import { consent } from '../lib/consent';

// Only render analytics when consent is granted
<ConsentGate instance={consent} category="analytics" fallback={<Placeholder />}>
  <AnalyticsDashboard />
</ConsentGate>

// 'necessary' always renders children
<ConsentGate instance={consent} category="necessary">
  <SecurityWidget />
</ConsentGate>
```

### Props

| Prop | Type | Description |
|------|------|-------------|
| `instance` | `ConsentifySubscribable<T>` | Consent instance from `createConsentify()` |
| `category` | `string` | Consent category to check |
| `children` | `ReactNode` | Content to render when consent is granted |
| `fallback` | `ReactNode` | Content to render when consent is denied (default: `null`) |

### SSR

During server-side rendering, `ConsentGate` renders the `fallback` (consent state is always `unset` on the server). After hydration, it re-renders based on the client-side consent state.

## License

MIT

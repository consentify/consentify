---
"@consentify/core": minor
---

Add typed event system (`on`/`once`) and `enableDebug()` adapter.

New APIs:
- `instance.on('change', handler)` - subscribe to consent state changes with typed `from`/`to`/`timestamp` payload
- `instance.on('clear', handler)` - subscribe to consent clear events
- `instance.once(type, handler)` - one-time event listener, auto-unsubscribes after first call
- `enableDebug(instance, options?)` - tree-shakeable debug adapter that logs consent changes

Also includes IIFE/UMD bundle (`dist/consentify.iife.min.js`) for script tag usage.

All existing APIs (`subscribe`, `guard`, `get`, `set`, `clear`) are unchanged.

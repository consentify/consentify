# Contributing to Consentify

Thanks for your interest in contributing!

## Prerequisites

- Node.js 20+
- pnpm 9+

## Setup

```bash
git clone https://github.com/consentify/consentify.git
cd consentify
pnpm install
```

## Development

```bash
# Build all packages
pnpm -r build

# Run tests
pnpm test
```

## Code Style

- TypeScript strict mode
- Zero runtime dependencies in `@consentify/core`
- All new features must include tests
- See `CLAUDE.md` for architecture patterns and conventions

## Bundle Size

Core package must stay under 5kb gzipped. Check with:

```bash
pnpm run size
```

If a feature significantly increases size, consider tree-shakeable exports (like `enableDebug`, `enableConsentMode`) or a separate package.

## Testing

Tests use vitest with happy-dom. All new features require tests:

```bash
pnpm test           # Run all tests
pnpm test -- --watch  # Watch mode
```

## Documentation

New public APIs must be documented in:
- Package `README.md` (API reference, examples)
- Root `README.md` (if user-facing)
- Relevant guides in `docs/`

## Versioning

Use [changesets](https://github.com/changesets/changesets) for version management:

```bash
pnpm changeset           # Create a changeset entry
pnpm changeset version   # Bump versions
```

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes and add tests
4. Run `pnpm -r build && pnpm -r check && pnpm test` to verify everything passes
5. Run `pnpm run size` to verify bundle budget
6. Commit with conventional commits (`feat:`, `fix:`, `refactor:`, etc.)
7. Open a PR to `main`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

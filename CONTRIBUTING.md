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

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes and add tests
4. Run `pnpm -r build && pnpm test` to verify everything passes
5. Commit with a descriptive message (`feat: add my feature`)
6. Open a PR to `main`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

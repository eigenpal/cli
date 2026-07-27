# Contributing to @eigenpal/cli

Thanks for your interest in improving the Eigenpal CLI!

## Filing issues

Bug reports and feature requests are welcome at
https://github.com/eigenpal/cli/issues. When filing a bug, please include:

- The CLI version (`eigenpal --version`)
- The exact command you ran
- The full error output
- Your OS and Node version

## Pull requests

We accept pull requests for:

- Bug fixes (with a clear repro)
- Documentation improvements
- New tests covering existing behavior

For larger changes (new commands, new flags, behavior changes), please open
an issue first to discuss the proposal — this saves you time if the change
isn't a fit.

## Local development

```bash
bun install
bun run build
node dist/cli.js --help
```

The CLI bundles its dependencies into a single `dist/cli.js` via
`bun build`. Source files import internal helpers via `@eigenpal/types`,
`@eigenpal/workflow-yaml`, and `@openparser/schema` aliases that resolve
to vendored copies under `internal/` (see `tsconfig.json` paths).

## Code of conduct

Be kind. Assume good faith. We're a small project — let's keep it pleasant.

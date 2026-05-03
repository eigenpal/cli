# internal/

Vendored source from upstream packages, used by the CLI at build time.

These files are bundled into `dist/cli.js` by `bun build` — they're not
part of the public API surface. Don't import from `internal/` paths in
external code; the layout may change between releases.

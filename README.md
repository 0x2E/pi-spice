# pi-extensions

A collection of my [pi](https://github.com/earendil-works/pi) extensions: small, self-contained, zero-dependency by default. Each extension is a directory under `extensions/` with a single `index.ts`, loaded directly by pi via jiti — no build step.

## Extensions

| Extension | Description |
|-----------|-------------|
| [prefer-ripgrep](./extensions/prefer-ripgrep/index.ts) | Nudges the model to use `rg` instead of `grep` / `egrep` / `ack` when writing search commands in bash (the built-in `grep` tool is already backed by ripgrep and is unaffected) |

## Installation

Each extension is one directory — copy it as-is:

```bash
# Global (all projects)
cp -r extensions/prefer-ripgrep ~/.pi/agent/extensions/

# Project-local (current project only; requires project trust on first use)
mkdir -p .pi/extensions && cp -r extensions/prefer-ripgrep .pi/extensions/
```

Quick test:

```bash
pi -e ./extensions/prefer-ripgrep/index.ts
```

Extensions placed in auto-discovered directories support hot-reload via `/reload`.

## License

[MIT](./LICENSE)

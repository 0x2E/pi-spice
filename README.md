# pi-extensions

A collection of my [pi](https://github.com/earendil-works/pi) extensions: small, self-contained, zero-dependency by default. Each extension is a directory under `extensions/`, published as an individual npm package and loaded directly via jiti — no build step.

## Extensions

| Extension | Description |
|-----------|-------------|
| [prefer-ripgrep](./extensions/prefer-ripgrep) | Nudges the model to use `rg` instead of `grep` / `egrep` / `ack` when writing search commands in bash (the built-in `grep` tool is already backed by ripgrep and is unaffected) |

## Installation

Each extension is an individual npm package:

```bash
pi install npm:@0x2e/pi-prefer-ripgrep
```

From a local checkout, or for a quick test without installing:

```bash
pi install ./extensions/prefer-ripgrep
pi -e ./extensions/prefer-ripgrep
```

Installed extensions hot-reload via `/reload`.

## License

[MIT](./LICENSE)

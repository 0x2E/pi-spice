# pi-spice

Small spices for [pi](https://github.com/earendil-works/pi) — tiny, self-contained, zero-dependency extensions, each published as an individual npm package under the `@pi-spice` scope. See each extension's README for install instructions and details.

Install the whole spice rack:

```bash
pi install npm:@pi-spice/all
```

## Extensions

| Extension | Core capability |
| --- | --- |
| [prefer-modern-cli](./extensions/prefer-modern-cli) | Nudges the agent toward modern CLI tools (`rg`, `fd`) over legacy `grep`/`find` |
| [thinking-preview](./extensions/thinking-preview) | Collapses streaming thinking blocks into a compact live preview |
| [minimal-subagents](./extensions/minimal-subagents) | Creates sub-agents inline and runs them in parallel via one blocking tool |

## License

[MIT](./LICENSE)

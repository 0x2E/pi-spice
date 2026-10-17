# pi-spice

Small spices for [pi](https://github.com/earendil-works/pi) — tiny, self-contained, zero-dependency extensions, each published as an individual npm package under the `@pi-spice` scope. Install the ones you want; see each extension's README for details. Note: some spices are mutually exclusive — `minimize-blocks` and `thinking-preview` both rewrite thinking display, so pick one.

## Extensions

| Extension | Core capability |
| --- | --- |
| [prefer-modern-cli](./extensions/prefer-modern-cli) | Prefer modern CLI tools such as `rg` and `fd` |
| [thinking-preview](./extensions/thinking-preview) | Collapses streaming thinking blocks into a compact live preview |
| [minimal-subagents](./extensions/minimal-subagents) | Creates sub-agents inline and runs them in parallel via one blocking tool |
| [minimize-blocks](./extensions/minimize-blocks) | Collapse tool rows and thinking blocks into one-line summaries |

## License

[MIT](./LICENSE)

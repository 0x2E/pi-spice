# pi-spice

Small, self-contained, zero-dependency extensions for [pi](https://github.com/earendil-works/pi), each published as its own npm package under the `@pi-spice` scope. Install only what you need; each extension's README covers the details.

`collapse-blocks` and `thinking-preview` are mutually exclusive: both transform thinking blocks, so pick one.

> **`@pi-spice/all` is deprecated** and will receive no further updates. If it is installed, remove it, then install the individual packages you want from the table below:
>
> ```bash
> pi remove npm:@pi-spice/all
> pi install npm:@pi-spice/prefer-modern-cli
> ```

## Extensions

| Extension | Core capability |
| --- | --- |
| [prefer-modern-cli](./extensions/prefer-modern-cli) | Prefer modern CLI tools such as `rg` and `fd` |
| [thinking-preview](./extensions/thinking-preview) | Collapse streaming thinking blocks into a compact live preview; `alt+t` toggles full text |
| [minimal-subagents](./extensions/minimal-subagents) | Create sub-agents dynamically and run them in parallel through one blocking tool, with no orchestration or nesting |
| [collapse-blocks](./extensions/collapse-blocks) | Collapse tool rows and thinking blocks into one-line summaries |

## License

[MIT](./LICENSE)

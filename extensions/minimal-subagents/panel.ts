/**
 * panel.ts — sub-agent details panel (overlay) for minimal-subagents
 *
 * Opened with alt+a (registered in index.ts). Shows the latest spawn_agents
 * call: one tab per sub-agent, a full scrollable timeline per tab (task,
 * tool calls, tool-result previews, assistant output rendered as markdown,
 * usage), live-updating while agents run.
 *
 * Rendering is line-based: the timeline is flattened into styled lines and
 * windowed by a hand-rolled viewport (offset math) — the overlay contract is
 * `render(width) => string[]`, so we control exactly which slice is visible.
 * Mouse wheel is parsed directly from SGR sequences reaching handleInput
 * while the overlay is focused.
 */

import { Markdown, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { type Message } from "@earendil-works/pi-ai";
import { formatToolCall, formatUsageStats, type RenderTheme } from "./render.ts";
import { type SingleResult, type SubagentDetails } from "./spawn.ts";

// ---------------------------------------------------------------------------
// Module state: the latest spawn_agents details, updated by index.ts
// ---------------------------------------------------------------------------

let currentDetails: SubagentDetails | null = null;
const listeners = new Set<() => void>();

/** Publish the latest (possibly still running) details; live panels re-render. */
export function setPanelDetails(details: SubagentDetails): void {
	currentDetails = details;
	for (const listener of listeners) listener();
}

// ---------------------------------------------------------------------------
// Panel opening
// ---------------------------------------------------------------------------

let opening: Promise<unknown> | null = null;

export function openAgentPanel(ctx: { ui: any; hasUI?: boolean }): void {
	if (opening) return; // already open; Esc closes
	if (ctx.hasUI === false) return;
	opening = ctx.ui
		.custom(
			(tui: any, theme: RenderTheme & { fg(c: string, t: string): string }, keybindings: any, done: () => void) =>
				new AgentPanel(tui, theme, keybindings, done),
			{
				overlay: true,
				overlayOptions: {
					anchor: "right-center",
					width: "50%",
					minWidth: 50,
					maxHeight: "80%",
					margin: 1,
				},
			},
		)
		.finally(() => {
			opening = null;
		});
}

// ---------------------------------------------------------------------------
// Timeline construction
// ---------------------------------------------------------------------------

const TOOL_RESULT_PREVIEW_LINES = 10;
const WHEEL_LINES = 3;

function statusIcon(result: SingleResult, theme: RenderTheme): string {
	if (result.exitCode === -1) return theme.fg("warning", "⏳");
	return isAgentFailed(result) ? theme.fg("error", "✗") : theme.fg("success", "✓");
}

function isAgentFailed(result: SingleResult): boolean {
	return result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
}

/** Flatten one agent's messages into styled lines (unwindowed). */
function buildTimeline(result: SingleResult, theme: RenderTheme, width: number): string[] {
	const lines: string[] = [];
	const push = (line: string) => {
		if (line.length === 0) lines.push("");
		else lines.push(...wrapTextWithAnsi(line, width));
	};

	const status =
		result.exitCode === -1
			? theme.fg("warning", "running")
			: isAgentFailed(result)
				? theme.fg("error", `failed${result.stopReason && result.stopReason !== "end" ? ` (${result.stopReason})` : ""}`)
				: theme.fg("success", "completed");

	push(`${theme.fg("toolTitle", theme.bold(result.name))} ${status}${result.model ? theme.fg("dim", ` · ${result.model}`) : ""}`);
	push(theme.fg("dim", `Task: ${result.task}`));
	lines.push("");

	const mdTheme = getMarkdownTheme();

	for (const msg of result.messages as Message[]) {
		if (msg.role === "user") continue; // the "Task: ..." prompt is already shown

		if (msg.role === "toolResult") {
			const text = (msg.content || [])
				.filter((p: any) => p.type === "text")
				.map((p: any) => p.text)
				.join("\n");
			if (!text.trim()) continue;
			const all = text.split("\n");
			const shown = all.slice(0, TOOL_RESULT_PREVIEW_LINES);
			for (const l of shown) push(theme.fg("muted", `  ${l}`));
			if (all.length > TOOL_RESULT_PREVIEW_LINES)
				push(theme.fg("dim", `  [+${all.length - TOOL_RESULT_PREVIEW_LINES} more lines]`));
			continue;
		}

		if (msg.role === "assistant") {
			for (const part of msg.content as any[]) {
				if (part.type === "thinking") continue;
				if (part.type === "toolCall") {
					push(`${theme.fg("muted", "→ ")}${formatToolCall(part.name, part.arguments, theme.fg.bind(theme))}`);
				} else if (part.type === "text" && part.text.trim()) {
					lines.push(...new Markdown(part.text.trim(), 0, 0, mdTheme).render(width));
					lines.push("");
				}
			}
		}
	}

	const usage = formatUsageStats(result.usage, result.model);
	if (usage) push(theme.fg("dim", usage));
	if (result.errorMessage) push(theme.fg("error", `Error: ${result.errorMessage}`));
	return lines;
}

// ---------------------------------------------------------------------------
// The panel component
// ---------------------------------------------------------------------------

class AgentPanel {
	private tui: any;
	private theme: RenderTheme;
	private keybindings: any;
	private close: () => void;

	private activeTab = 0;
	private offset = 0;
	private follow = true;
	private bodyHeight = 10;
	private lineCount = 0;
	private renderWidth = 60;

	private notify: () => void;

	constructor(tui: any, theme: RenderTheme, keybindings: any, done: (value: null) => void) {
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.close = () => {
			listeners.delete(this.notify);
			done(null);
		};
		this.notify = () => this.tui.requestRender();
		listeners.add(this.notify);
	}

	render(width: number): string[] {
		try {
			return this.renderInner(width);
		} catch (err) {
			// A panel bug must never crash the host TUI.
			return [this.theme.fg("error", `panel render failed: ${err instanceof Error ? err.message : String(err)}`)];
		}
	}

	private renderInner(width: number): string[] {
		const theme = this.theme;
		const details = currentDetails;
		if (!details || details.results.length === 0)
			return [theme.fg("muted", "(no agent data yet — run spawn_agents first)")];

		this.renderWidth = width;

		// --- header: tab bar ------------------------------------------------
		const tabs = details.results
			.map((r, i) => {
				const label = `${i + 1} ${r.name} ${statusIcon(r, theme)}`;
				return i === this.activeTab ? theme.fg("accent", theme.bold(`[${label}]`)) : theme.fg("dim", ` ${label} `);
			})
			.join(theme.fg("muted", "│"));
		const header = [theme.fg("toolTitle", theme.bold("agents ")) + tabs, theme.fg("muted", "─".repeat(width))];

		// --- body: windowed timeline ----------------------------------------
		const rows = this.tui?.terminal?.rows ?? process.stdout.rows ?? 24;
		const cap = Math.floor(rows * 0.8) - 2; // overlay maxHeight "80%", minus safety
		this.bodyHeight = Math.max(4, cap - header.length - 1 /* footer */);

		const lines = buildTimeline(details.results[this.activeTab], theme, width);
		this.lineCount = lines.length;

		const maxOffset = Math.max(0, this.lineCount - this.bodyHeight);
		if (this.follow) this.offset = maxOffset;
		this.offset = Math.min(Math.max(0, this.offset), maxOffset);
		const body = lines.slice(this.offset, this.offset + this.bodyHeight);
		while (body.length < this.bodyHeight) body.push(""); // stable panel height

		// --- footer: scroll position + hints ---------------------------------
		const pos = this.lineCount > 0 ? `${this.offset + 1}-${Math.min(this.offset + this.bodyHeight, this.lineCount)}/${this.lineCount}` : "0";
		const mode = this.follow ? "following" : "paused";
		const footer =
			theme.fg("dim", `${pos} ${mode}`) +
			theme.fg("muted", " · ←/→ tab · ↑/↓ wheel scroll · End follow · Esc close");

		return [...header, ...body, theme.fg("muted", "─".repeat(width)), footer];
	}

	handleInput(data: string): void {
		const details = currentDetails;
		if (!details || details.results.length === 0) {
			if (data === "\x1b") this.close();
			return;
		}
		const tabCount = details.results.length;

		// SGR mouse wheel: \x1B[<64;col;rowM (up) / 65 (down)
		if (data.startsWith("\x1b[<") && data.endsWith("M")) {
			const b = Number.parseInt(data.slice(3, data.indexOf(";")), 10);
			if (b === 64) this.scroll(-WHEEL_LINES);
			else if (b === 65) this.scroll(WHEEL_LINES);
			return;
		}

		switch (data) {
			case "\x1b": // Esc alone
				this.close();
				return;
			case "\x1b[D": // left
			case "\x1b[1;5D": // ctrl+left
				this.switchTab((this.activeTab - 1 + tabCount) % tabCount);
				return;
			case "\x1b[C": // right
			case "\x1b[1;5C": // ctrl+right
				this.switchTab((this.activeTab + 1) % tabCount);
				return;
			case "\x1b[A":
				this.scroll(-1);
				return;
			case "\x1b[B":
				this.scroll(1);
				return;
			case "\x1b[H":
			case "g":
				this.offset = 0;
				this.follow = false;
				this.tui.requestRender();
				return;
			case "\x1b[F":
			case "G":
				this.follow = true;
				this.tui.requestRender();
				return;
		}

		// Number keys 1..8 jump to a tab
		if (/^[1-9]$/.test(data)) {
			const idx = Number(data) - 1;
			if (idx < tabCount) this.switchTab(idx);
			return;
		}

		// Paging respects user keybindings (tui.altScreen.* ids)
		const kb = this.keybindings;
		if (kb?.matches) {
			if (kb.matches(data, "tui.altScreen.pageUp")) {
				this.scroll(-this.bodyHeight);
				return;
			}
			if (kb.matches(data, "tui.altScreen.pageDown")) {
				this.scroll(this.bodyHeight);
				return;
			}
			if (kb.matches(data, "tui.altScreen.halfPageUp")) {
				this.scroll(-Math.ceil(this.bodyHeight / 2));
				return;
			}
			if (kb.matches(data, "tui.altScreen.halfPageDown")) {
				this.scroll(Math.ceil(this.bodyHeight / 2));
				return;
			}
		}
	}

	private switchTab(idx: number): void {
		this.activeTab = idx;
		this.offset = 0;
		this.follow = true;
		this.tui.requestRender();
	}

	private scroll(delta: number): void {
		const maxOffset = Math.max(0, this.lineCount - this.bodyHeight);
		this.offset = Math.min(Math.max(0, this.offset + delta), maxOffset);
		this.follow = this.offset >= maxOffset && delta > 0;
		this.tui.requestRender();
	}

	invalidate(): void {
		// nothing cached across renders; theme changes are picked up next render
	}
}



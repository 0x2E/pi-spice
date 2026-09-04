/**
 * panel.ts — sub-agent details panel (overlay) for minimal-subagents
 *
 * Opened with alt+a (registered in index.ts), closed with alt+a or Esc —
 * while the panel is focused the host routes all input here, so the open
 * shortcut never fires; the panel must recognize alt+a itself to toggle.
 * With no spawn_agents data yet, the shortcut shows a notify message
 * instead of opening an empty overlay (guarded in index.ts via
 * hasPanelDetails).
 * Shows the latest spawn_agents call: one tab per sub-agent, a full scrollable
 * timeline per tab (task, tool calls, tool-result previews, assistant output
 * rendered as markdown, usage), live-updating while agents run.
 *
 * Rendering is line-based: the timeline is flattened into styled lines and
 * windowed by a hand-rolled viewport (offset math) — the overlay contract is
 * `render(width) => string[]`, so we control exactly which slice is visible.
 * Mouse wheel is parsed directly from SGR sequences reaching handleInput
 * while the overlay is focused.
 */

import { Markdown, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { type Message } from "@earendil-works/pi-ai";
import { formatToolCall, formatUsageStats, type RenderTheme } from "./render.ts";
import { isFailedResult, type SingleResult, type SubagentDetails } from "./spawn.ts";

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

/** True once at least one spawn_agents result (even still running) exists. */
export function hasPanelDetails(): boolean {
	return currentDetails !== null && currentDetails.results.length > 0;
}

// ---------------------------------------------------------------------------
// Panel opening
// ---------------------------------------------------------------------------

let opening: Promise<unknown> | null = null;

export function openAgentPanel(ctx: { ui: any; hasUI?: boolean }): void {
	if (opening) return; // already open; alt+a or Esc closes
	if (ctx.hasUI === false) return;
	opening = ctx.ui
		.custom(
			(tui: any, theme: RenderTheme & { fg(c: string, t: string): string }, keybindings: any, done: () => void) =>
				new AgentPanel(tui, theme, keybindings, done),
			{
				overlay: true,
				overlayOptions: {
				// Full-height right column: anchor top-right, zero margin, and
				// render() always returns exactly `rows` lines (overlay height is
				// content-driven, capped by maxHeight).
				anchor: "top-right",
				width: "50%",
				minWidth: 50,
				maxHeight: "100%",
				margin: 0,
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

function isAgentRunning(result: SingleResult): boolean {
	return result.exitCode === -1;
}

function statusIcon(result: SingleResult, theme: RenderTheme): string {
	if (isAgentRunning(result))
		return result.messages.length === 0 ? theme.fg("muted", "·") : theme.fg("warning", "✻");
	return isFailedResult(result) ? theme.fg("error", "✗") : theme.fg("success", "✓");
}

/** Flatten one agent's messages into styled lines (unwindowed). */
function buildTimeline(result: SingleResult, theme: RenderTheme, width: number): string[] {
	const lines: string[] = [];
	const push = (line: string) => {
		if (line.length === 0) lines.push("");
		else lines.push(...wrapTextWithAnsi(line, width));
	};

	const status =
		isAgentRunning(result)
			? theme.fg("warning", "running")
			: isFailedResult(result)
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
		// A newer spawn_agents call may have fewer agents — clamp the tab.
		this.activeTab = Math.min(this.activeTab, details.results.length - 1);

		// Inner padding: 1 column each side and 1 blank line above/below the
		// body, so content breathes away from the rules and panel edges. The
		// rules span the full width; content wraps at width - 2.
		const innerWidth = Math.max(10, width - 2);
		const pad = (line: string) => (line.length === 0 ? "" : ` ${line}`);

		// --- header: tab bar ------------------------------------------------
		// Full labels (index + name + status) when they fit the panel width;
		// otherwise degrade to compact slots (index + status) which always fit
		// for up to MAX_AGENTS=8 tabs — the active agent's full identity stays
		// visible as the timeline's first line either way.
		const sep = theme.fg("muted", "│");
		const renderSlots = (labels: string[]) =>
			labels.map((label, i) => (i === this.activeTab ? theme.fg("accent", theme.bold(`[${label}]`)) : theme.fg("dim", ` ${label} `))).join(sep);
		const fullLabels = details.results.map((r, i) => {
			const name = r.name.length > 12 ? `${r.name.slice(0, 11)}…` : r.name;
			return `${i + 1} ${name} ${statusIcon(r, theme)}`;
		});
		const fullFits =
			7 + fullLabels.reduce((sum, l) => sum + visibleWidth(l) + 2, 0) + (fullLabels.length - 1) <= innerWidth;
		const tabs = fullFits
			? renderSlots(fullLabels)
			: renderSlots(details.results.map((r, i) => `${i + 1}${statusIcon(r, theme)}`));
		const header = [pad(theme.fg("toolTitle", theme.bold("agents ")) + tabs), theme.fg("muted", "─".repeat(width))];

		// --- body: windowed timeline ----------------------------------------
		const rows = this.tui?.terminal?.rows ?? process.stdout.rows ?? 24;
		const headerH = header.length + 1; // blank pad + tab bar + rule
		const footerH = 2 + 1; // rule + status line + blank pad above the rule
		this.bodyHeight = Math.max(4, rows - headerH - footerH);

		const lines = buildTimeline(details.results[this.activeTab], theme, innerWidth);
		this.lineCount = lines.length;

		const maxOffset = Math.max(0, this.lineCount - this.bodyHeight);
		if (this.follow) this.offset = maxOffset;
		this.offset = Math.min(Math.max(0, this.offset), maxOffset);
		const body = lines.slice(this.offset, this.offset + this.bodyHeight).map(pad);
		while (body.length < this.bodyHeight) body.push(""); // stable panel height

		// --- footer: scroll position + hints ---------------------------------
		const pos = this.lineCount > 0 ? `${this.offset + 1}-${Math.min(this.offset + this.bodyHeight, this.lineCount)}/${this.lineCount}` : "0";
		const mode = this.follow ? "following" : "paused";
		const statusText = theme.fg("dim", `${pos} ${mode}`);
		// Hint set degrades as the panel narrows; truncate is only a backstop.
		const hintVariants = [
			" · ←/→ tab · ↑/↓ scroll · End follow · alt+a/Esc close",
			" · ←/→ tab · End follow · alt+a/Esc close",
			" · alt+a/Esc close",
		];
		let hints = "";
		for (const hint of hintVariants) {
			if (visibleWidth(statusText) + hint.length <= innerWidth) {
				hints = theme.fg("muted", hint);
				break;
			}
		}
		const footer = truncateToWidth(pad(statusText + hints), width);

		return ["", ...header, ...body, "", theme.fg("muted", "─".repeat(width)), footer];
	}

	handleInput(data: string): void {
		try {
			this.handleInputInner(data);
		} catch (err) {
			// A panel bug must never crash the host TUI.
			this.tui.requestRender();
		}
	}

	private handleInputInner(data: string): void {
		// alt+a toggles: while we hold focus the host shortcut cannot fire, so
		// the panel closes on the same key that opened it (matchesKey covers
		// legacy ESC+a and kitty/CSI-u encodings alike).
		if (matchesKey(data, "alt+a")) {
			this.close();
			return;
		}

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



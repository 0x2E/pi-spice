/**
 * panel.ts — sub-agent details panel (overlay) for minimal-subagents
 *
 * alt+a (registered in index.ts) opens the panel; with no data yet, index.ts
 * shows a notify instead. While the panel has focus the host routes all input
 * here, so the open shortcut cannot fire — the panel recognizes alt+a itself
 * to toggle, and Esc closes it. It shows every agent this session in spawn
 * order: one tab per agent with a scrollable timeline (task, tool calls,
 * tool-result previews, markdown output, usage), live-updating while an agent
 * runs. The oldest tab falls off past MAX_PANEL_AGENTS.
 *
 * Rendering is line-based: the timeline is flattened into styled lines and
 * windowed by a hand-rolled viewport, because the overlay contract is
 * `render(width) => string[]`. Mouse wheel is parsed from SGR sequences; every
 * other key goes through matchesKey, which covers the kitty CSI-u encoding
 * that pi negotiates at startup (raw `"\x1b[C"` literals would not).
 */

import { Markdown, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { type Message } from "@earendil-works/pi-ai";
import { formatToolCall, formatUsageStats, type RenderTheme } from "./render.ts";
import { failureStatus, isFailedResult, type SingleResult } from "./spawn.ts";

// ---------------------------------------------------------------------------
// Module state: every agent this session, keyed by the call that produced it
// ---------------------------------------------------------------------------

/** Tabs are cheap to draw but useless in dozens — keep the most recent finished. */
const MAX_PANEL_AGENTS = 8;

/** One panel tab: the call that produced the agent, and its latest state. */
interface PanelEntry {
	toolCallId: string;
	result: SingleResult;
}

const entries: PanelEntry[] = [];
const listeners = new Set<() => void>();

/**
 * Publish an agent's latest state — a call re-publishes its own entry on every
 * child event, so a live panel re-renders, while other calls' agents stay put.
 */
export function upsertAgent(toolCallId: string, result: SingleResult): void {
	const existing = entries.findIndex((entry) => entry.toolCallId === toolCallId);
	if (existing === -1) entries.push({ toolCallId, result });
	else entries[existing] = { toolCallId, result };
	if (entries.length > MAX_PANEL_AGENTS) {
		// Evict the oldest finished agent. Never a live one — its next update
		// would re-append it at the end and reorder the tabs — and never the
		// entry just updated, which is the one you opened the panel to look at.
		// With every tab live the bar briefly exceeds the cap.
		const victim = entries.findIndex((entry, index) => index !== existing && entry.result.exitCode !== -1);
		if (victim !== -1) entries.splice(victim, 1);
	}
	for (const listener of listeners) listener();
}

/** True once at least one spawn_agents result (even still running) exists. */
export function hasAgents(): boolean {
	return entries.length > 0;
}

/** Agents in spawn order — the panel's read model. */
export function listAgents(): SingleResult[] {
	return entries.map((entry) => entry.result);
}

/**
 * Tabs to draw for a width budget. Whole range when it fits, else the widest
 * window around the active tab — the tab being looked at must never slide off
 * the edge of a narrow panel, and `‹`/`›` mark what is hidden.
 */
export function fitTabs(
	slots: string[],
	active: number,
	budget: number,
	measure: (slot: string) => number,
): { from: number; to: number } {
	const widthOf = (from: number, to: number) => {
		let width = Math.max(0, to - from - 1); // separators between slots
		if (from > 0) width += 2; // marker + separator
		if (to < slots.length) width += 2; // separator + marker
		for (let i = from; i < to; i++) width += measure(slots[i]);
		return width;
	};
	let from = Math.min(Math.max(0, active), slots.length - 1);
	let to = from + 1;
	for (;;) {
		let grew = false;
		if (from > 0 && widthOf(from - 1, to) <= budget) {
			from--;
			grew = true;
		}
		if (to < slots.length && widthOf(from, to + 1) <= budget) {
			to++;
			grew = true;
		}
		if (!grew) break;
	}
	return { from, to };
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
	return result.phase !== "finished";
}

function statusLabel(result: SingleResult, theme: RenderTheme): string {
	if (result.phase === "queued") return theme.fg("muted", "queued");
	if (isAgentRunning(result)) return theme.fg("warning", "running");
	return isFailedResult(result) ? theme.fg("error", failureStatus(result)) : theme.fg("success", "completed");
}

function statusIcon(result: SingleResult, theme: RenderTheme): string {
	if (result.phase === "queued") return theme.fg("muted", "·");
	if (isAgentRunning(result)) return theme.fg("warning", "✻");
	return isFailedResult(result) ? theme.fg("error", "✗") : theme.fg("success", "✓");
}

/** Flatten one agent's messages into styled lines (unwindowed). */
function buildTimeline(result: SingleResult, theme: RenderTheme, width: number): string[] {
	const lines: string[] = [];
	const push = (line: string) => {
		if (line.length === 0) lines.push("");
		else lines.push(...wrapTextWithAnsi(line, width));
	};

	const status = statusLabel(result, theme);
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
		// Open on the newest agent: later spawns are what you came to look at,
		// and the tab bar (windowed) still shows the rest.
		this.activeTab = Math.max(0, listAgents().length - 1);
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
		const agents = listAgents();
		if (agents.length === 0) return [theme.fg("muted", "(no agent data yet — run spawn_agents first)")];

		this.renderWidth = width;
		// Evicting the oldest agents can shrink the list under the open tab.
		this.activeTab = Math.min(this.activeTab, agents.length - 1);

		// Inner padding: 1 column each side and 1 blank line above/below the
		// body, so content breathes away from the rules and panel edges. The
		// rules span the full width; content wraps at width - 2.
		const innerWidth = Math.max(10, width - 2);
		const pad = (line: string) => (line.length === 0 ? "" : ` ${line}`);

		// --- header: tab bar ------------------------------------------------
		// Full labels (index + name + status) when they all fit; otherwise
		// compact slots (index + status). Either way the bar is windowed so the
		// active tab stays visible and hidden tabs are marked with ‹ ›.
		const sep = theme.fg("muted", "│");
		const fullLabels = agents.map((r, i) => {
			const name = r.name.length > 12 ? `${r.name.slice(0, 11)}…` : r.name;
			return `${i + 1} ${name} ${statusIcon(r, theme)}`;
		});
		const fullFits = 7 + fullLabels.reduce((sum, l) => sum + visibleWidth(l) + 2, 0) + (fullLabels.length - 1) <= innerWidth;
		// Slots carry their own padding so fitTabs measures what actually renders;
		// the active tab replaces the padding with brackets of the same width.
		const slots = (fullFits ? fullLabels : agents.map((r, i) => `${i + 1}${statusIcon(r, theme)}`)).map(
			(label) => ` ${label} `,
		);
		const budget = Math.max(4, innerWidth - 6); // "agents " prefix + left pad
		const { from, to } = fitTabs(slots, this.activeTab, budget, visibleWidth);
		const parts: string[] = [];
		for (let i = from; i < to; i++) {
			parts.push(
				i === this.activeTab
					? theme.fg("accent", theme.bold(`[${slots[i].trim()}]`))
					: theme.fg("dim", slots[i]),
			);
		}
		const tabs = truncateToWidth(
			`${from > 0 ? theme.fg("muted", "‹ ") : ""}${parts.join(sep)}${to < slots.length ? theme.fg("muted", " ›") : ""}`,
			budget,
		);
		const header = [pad(theme.fg("toolTitle", theme.bold("agents ")) + tabs), theme.fg("muted", "─".repeat(width))];

		// --- body: windowed timeline ----------------------------------------
		const rows = this.tui?.terminal?.rows ?? process.stdout.rows ?? 24;
		const headerH = header.length + 1; // blank pad + tab bar + rule
		const footerH = 2 + 1; // rule + status line + blank pad above the rule
		this.bodyHeight = Math.max(4, rows - headerH - footerH);

		const lines = buildTimeline(agents[this.activeTab], theme, innerWidth);
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

		const agents = listAgents();
		if (agents.length === 0) {
			if (matchesKey(data, "escape")) this.close();
			return;
		}
		const tabCount = agents.length;

		// SGR mouse wheel: \x1B[<64;col;rowM (up) / 65 (down)
		if (data.startsWith("\x1b[<") && data.endsWith("M")) {
			const b = Number.parseInt(data.slice(3, data.indexOf(";")), 10);
			if (b === 64) this.scroll(-WHEEL_LINES);
			else if (b === 65) this.scroll(WHEEL_LINES);
			return;
		}

		// Key matching is protocol-independent (matchesKey handles legacy xterm,
		// SS3 and kitty CSI-u encodings). The panel keeps focus, so every keypress
		// that matches nothing above is simply dropped here.
		if (matchesKey(data, "escape")) {
			this.close();
			return;
		}
		if (matchesKey(data, "left") || matchesKey(data, "ctrl+left")) {
			this.switchTab((this.activeTab - 1 + tabCount) % tabCount);
			return;
		}
		if (matchesKey(data, "right") || matchesKey(data, "ctrl+right")) {
			this.switchTab((this.activeTab + 1) % tabCount);
			return;
		}
		if (matchesKey(data, "up")) {
			this.scroll(-1);
			return;
		}
		if (matchesKey(data, "down")) {
			this.scroll(1);
			return;
		}
		if (matchesKey(data, "home") || matchesKey(data, "g")) {
			this.offset = 0;
			this.follow = false;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "end") || matchesKey(data, "shift+g")) {
			this.follow = true;
			this.tui.requestRender();
			return;
		}

		// Number keys 1..9 jump to a tab (matchesKey also covers the CSI-u form
		// a report-all-keys terminal would send)
		const numberKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
		for (const [idx, key] of numberKeys.entries()) {
			if (matchesKey(data, key)) {
				if (idx < tabCount) this.switchTab(idx);
				return;
			}
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



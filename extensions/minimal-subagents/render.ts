/**
 * render.ts — TUI presentation for minimal-subagents
 *
 * All rendering for the spawn_agents tool call and its (possibly still
 * streaming) result: collapsed/expanded views of one agent, tool-call lines
 * mimicking pi's built-in tool formatting, usage stats, and markdown final
 * output. The alt+a panel owns the multi-agent, cross-call view. Pure
 * presentation — no spawning logic here.
 */

import * as os from "node:os";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { type Component, Container, Markdown, Spacer, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { getFinalOutput, isFailedResult, type SingleResult } from "./spawn.ts";

/** Structural slice of pi's theme object — keeps this file decoupled from theme internals. */
export interface RenderTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

export function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		turns?: number;
	},
	model?: string,
): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	}
	if (model) parts.push(model);
	return parts.join(" ");
}

/** Terminal width for transcript lines; render hooks get no width from the host. Falls back to 80 on a falsy value. */
function terminalColumns(): number {
	return process.stdout.columns || 80;
}

/** pi renders tool results inside a Box(1,1): block lines get 2 columns less than the terminal. */
const BLOCK_INSET = 2;

/** Left indent of task/activity continuation rows inside a block. */
const ROW_INDENT = 2;

/**
 * Width-aware truncation for ANSI-styled text. `truncateToWidth` counts display
 * columns and never splits an escape sequence or grapheme cluster; hand-built
 * transcript lines must use it instead of `String.slice`.
 *
 * Its ellipsis comes wrapped in a bare `\x1b[0m`, which would clear the tool
 * block's background. Stripping that reset is not enough when the cut lands
 * inside a styled span: the span's scoped close is gone, and `wrapTextWithAnsi`
 * carries open SGR attributes onto later rows. On real truncation, re-close fg
 * and bold with scoped resets (`\x1b[22m\x1b[39m`), which leave the background
 * alone.
 */
function truncateVisual(text: string, maxCols: number): string {
	const truncated = truncateToWidth(text, maxCols, "…").replaceAll("\x1b[0m", "");
	return visibleWidth(text) > maxCols ? truncated + "\x1b[22m\x1b[39m" : truncated;
}

export function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: any, text: string) => string,
): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview = truncateVisual(command, 60);
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath));
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "find ") + themeFg("accent", pattern) + themeFg("dim", ` in ${shortenPath(rawPath)}`);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		default: {
			// Unknown tools: preview the first string argument (a path, pattern,
			// command — whatever it is) instead of dumping raw JSON.
			const firstString = Object.values(args).find((v): v is string => typeof v === "string" && v.length > 0);
			const preview = firstString ? ` ${truncateVisual(firstString, 50)}` : "";
			return themeFg("accent", toolName) + themeFg("dim", preview);
		}
	}
}

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, any> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

/**
 * The call slot stays empty. Only the result knows the agent's resolved name —
 * the default `agent-N` is assigned by the extension, not present in the raw
 * args — and only the result knows the status, so the result draws the whole
 * row: name and status on one line, the task underneath.
 */
const emptySlot: Component = { render: () => [], invalidate: () => {} };

export function renderSpawnCall(): Component {
	return emptySlot;
}

/** Width available to one block line: the terminal minus pi's box padding. */
function bodyWidth(): number {
	return Math.max(1, terminalColumns() - BLOCK_INSET);
}

/** The agent's identity with its status right after it: `subagent t1  ✓ 7s · 1 tool`. */
function agentHeader(r: SingleResult, theme: RenderTheme, status: string): string {
	return `${theme.fg("toolTitle", theme.bold("subagent"))} ${theme.fg("accent", r.name)}  ${status}`;
}

/** Right-hand fragment: glyph plus duration/tools, or the queued state. */
function statusText(r: SingleResult, theme: RenderTheme): string {
	return isQueued(r)
		? `${statusGlyph(r, theme)} ${theme.fg("muted", "queued")}`
		: `${statusGlyph(r, theme)} ${theme.fg("dim", headerStats(r))}`;
}

function isAgentRunning(result: SingleResult): boolean {
	return result.phase !== "finished";
}

// --- glyph system ------------------------------------------------------------
// Single-width glyphs only (⏳ renders emoji-wide on many terminals and breaks
// column alignment): ✻ running · queued ✓ done ✗ failed.

function statusGlyph(r: SingleResult, theme: RenderTheme): string {
	if (r.phase === "queued") return theme.fg("muted", "·");
	if (r.phase === "running") return theme.fg("warning", "✻");
	return isFailedResult(r) ? theme.fg("error", "✗") : theme.fg("success", "✓");
}

function toolUseCount(messages: Message[]): number {
	let n = 0;
	for (const msg of messages) {
		if (msg.role !== "assistant") continue;
		for (const part of msg.content as any[]) if (part.type === "toolCall") n++;
	}
	return n;
}

export function formatDuration(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
	return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Agent wall time; while running, elapsed since start (recomputed each render). */
function agentDuration(r: SingleResult): number {
	return Math.max(0, (r.endedAt ?? Date.now()) - r.startedAt);
}

/** Duration + tool count, plus tokens and cost once the agent has finished. */
function headerStats(r: SingleResult): string {
	const parts = [formatDuration(agentDuration(r))];
	const tools = toolUseCount(r.messages);
	if (tools) parts.push(`${tools} tool${tools > 1 ? "s" : ""}`);
	if (r.exitCode !== -1) {
		if (r.usage.output) parts.push(`↓${formatTokens(r.usage.output)}`);
		if (r.usage.cost) parts.push(`$${r.usage.cost.toFixed(4)}`);
	}
	return parts.join(" · ");
}

function failReason(r: SingleResult): string {
	return (r.errorMessage || r.stderr || r.stopReason || "error").split("\n")[0];
}

function taskFirstLine(task: string): string {
	return task.split("\n").find((l) => l.trim().length > 0) ?? "";
}

/** Latest tool call or assistant text; only meaningful while the agent is in flight. */
function runningActivity(r: SingleResult, theme: RenderTheme): string | null {
	if (r.exitCode !== -1 || isQueued(r)) return null;
	const items = getDisplayItems(r.messages);
	const last = items[items.length - 1];
	if (!last) return theme.fg("muted", "starting…");
	if (last.type === "toolCall") return formatToolCall(last.name, last.args, theme.fg.bind(theme));
	return theme.fg("toolOutput", last.text.split("\n")[0]);
}

function isQueued(r: SingleResult): boolean {
	return r.phase === "queued";
}

/**
 * Collapsed view: the agent and its status share one line, the task sits
 * underneath, and a live agent adds its latest activity plus the panel hint.
 * Failures put their reason on the line after the task.
 */
function scoreboardView(r: SingleResult, theme: RenderTheme): Text {
	const width = bodyWidth();
	const rowCols = Math.max(1, width - ROW_INDENT);
	const lines = [truncateVisual(agentHeader(r, theme, statusText(r, theme)), width)];

	const task = taskFirstLine(r.task);
	if (task) lines.push(`${" ".repeat(ROW_INDENT)}${truncateVisual(theme.fg("dim", task), rowCols)}`);
	if (isFailedResult(r)) lines.push(`${" ".repeat(ROW_INDENT)}${truncateVisual(theme.fg("error", failReason(r)), rowCols)}`);

	const activity = runningActivity(r, theme);
	if (activity) lines.push(`${" ".repeat(ROW_INDENT)}${truncateVisual(activity, rowCols)}`);
	if (isAgentRunning(r)) lines.push(truncateVisual(theme.fg("muted", "alt+a live details"), width));
	return new Text(lines.join("\n"), 0, 0);
}

export function renderSpawnResult(
	result: AgentToolResult<SingleResult>,
	{ expanded }: { expanded: boolean },
	theme: RenderTheme,
): Text | Container {
	const agent = result.details as SingleResult | undefined;
	if (!agent) {
		const text = result.content[0];
		return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
	}

	if (expanded && !isAgentRunning(agent)) {
		// Expanded (ctrl+o, after completion): a quantified header and the final
		// output as Markdown. The panel (alt+a) owns the per-tool timeline, so
		// the transcript does not repeat it.
		const r = agent;
		const container = new Container();
		const isError = isFailedResult(r);
		const status = `${statusGlyph(r, theme)} ${theme.fg("dim", headerStats(r))}${isError && r.stopReason ? ` ${theme.fg("error", `[${r.stopReason}]`)}` : ""}`;
		container.addChild(new Text(truncateVisual(agentHeader(r, theme, status), bodyWidth()), 0, 0));
		if (isError && r.errorMessage)
			container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
		container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));
		const finalOutput = getFinalOutput(r.messages);
		if (finalOutput.trim()) {
			container.addChild(new Spacer(1));
			container.addChild(new Markdown(finalOutput.trim(), 0, 0, getMarkdownTheme()));
		} else {
			container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
		}
		return container;
	}

	return scoreboardView(agent, theme);
}

/**
 * render.ts — TUI presentation for minimal-subagents
 *
 * All rendering for the spawn_agents tool call and its (possibly still
 * streaming) result: collapsed/expanded views per agent, tool-call lines
 * mimicking pi's built-in tool formatting, usage stats, and markdown final
 * output. Pure presentation — no spawning logic here.
 */

import * as os from "node:os";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text, truncateToWidth } from "@earendil-works/pi-tui";
import {
	getFinalOutput,
	isFailedResult,
	type AgentSpec,
	type SingleResult,
	type SubagentDetails,
} from "./spawn.ts";

/** Structural view of the tool's args — avoids a type-only import cycle with index.ts. */
export type SpawnAgentsArgs = { agents?: AgentSpec[] };

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

/** Terminal width for transcript lines — the render hooks get no width from the host. */
function terminalColumns(): number {
	return process.stdout.columns ?? 80;
}

/**
 * Width-aware truncation for possibly ANSI-styled text: `truncateToWidth`
 * measures display columns (CJK = 2, escapes = 0) and never slices an escape
 * sequence or grapheme cluster in half. Hand-assembled transcript lines must
 * go through this — never `String.slice`, which counts UTF-16 units and
 * overflows on CJK text or styled strings.
 */
function truncateVisual(text: string, maxCols: number): string {
	return truncateToWidth(text, maxCols, "…");
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

export function renderSpawnCall(args: SpawnAgentsArgs, theme: RenderTheme): Text {
	// One line only: agent names and task previews live in the result blocks
	// (seeded the moment the tool starts), so repeating them here would just
	// duplicate the list below.
	const count = args.agents?.length;
	if (count) {
		const text =
			theme.fg("toolTitle", theme.bold("spawn_agents ")) +
			theme.fg("accent", `(${count} agent${count > 1 ? "s" : ""})`);
		return new Text(text, 0, 0);
	}
	return new Text(theme.fg("toolTitle", theme.bold("spawn_agents")), 0, 0);
}

function isAgentRunning(details: SubagentDetails): boolean {
	return details.results.some((r) => r.exitCode === -1);
}

// --- glyph system ------------------------------------------------------------
// Single-width glyphs only (⏳ renders emoji-wide on many terminals and breaks
// column alignment): ✻ running · queued ✓ done ✗ failed.

function statusGlyph(r: SingleResult, theme: RenderTheme): string {
	if (r.exitCode === -1) return r.messages.length === 0 ? theme.fg("muted", "·") : theme.fg("warning", "✻");
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

/** Whole-call wall time: earliest start to latest end. */
function callDuration(details: SubagentDetails): number {
	const start = Math.min(...details.results.map((r) => r.startedAt));
	const end = Math.max(...details.results.map((r) => r.endedAt ?? Date.now()));
	return Math.max(0, end - start);
}

function aggregateUsage(results: SingleResult[]) {
	const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
	for (const r of results) {
		total.input += r.usage.input;
		total.output += r.usage.output;
		total.cacheRead += r.usage.cacheRead;
		total.cacheWrite += r.usage.cacheWrite;
		total.cost += r.usage.cost;
		total.turns += r.usage.turns;
	}
	return total;
}

/** Duration + tool count + (once finished) tokens and cost — expanded headers. */
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

/** Duration + tool count only — collapsed headers; tokens/cost live on the summary line. */
function collapsedStats(r: SingleResult): string {
	const parts = [formatDuration(agentDuration(r))];
	const tools = toolUseCount(r.messages);
	if (tools) parts.push(`${tools} tool${tools > 1 ? "s" : ""}`);
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
	return r.exitCode === -1 && r.messages.length === 0;
}

/**
 * The collapsed transcript block under the one-line call header
 * (`spawn_agents (N agents)`). Every agent is a 2-line block — glyph + name
 * + stats, then the first line of its task (the stable identifier, even
 * when names are opaque). Running agents grow a third line with the latest
 * tool call. Failed agents put the error on the header; tokens/cost live
 * only on the call-total summary (multi-agent, finished). The hint line is
 * running-only. The panel (alt+a) is the live timeline; this stays a summary.
 */
function scoreboardView(details: SubagentDetails, theme: RenderTheme): Text {
	const results = details.results;
	const running = results.filter((r) => r.exitCode === -1).length;
	const successCount = results.filter((r) => r.exitCode !== -1 && !isFailedResult(r)).length;
	const failCount = results.length - running - successCount;
	const isRunning = running > 0;

	let summary = "";
	if (!isRunning && results.length > 1) {
		const parts = [`${successCount}/${results.length}`];
		if (failCount > 0) parts.push(`${failCount} failed`);
		parts.push(formatDuration(callDuration(details)));
		const total = aggregateUsage(results);
		const totalTools = results.reduce((n, r) => n + toolUseCount(r.messages), 0);
		if (totalTools > 0) parts.push(`${totalTools} tools`);
		if (total.output) parts.push(`↓${formatTokens(total.output)}`);
		if (total.cost) parts.push(`$${total.cost.toFixed(4)}`);
		summary = parts.join(" · ");
	}

	// Label models only when the call mixes them — a uniform call would
	// just repeat the parent's model on every block.
	const models = new Set(results.map((r) => r.model).filter(Boolean));
	const showModels = models.size > 1;
	const cols = terminalColumns();

	const lines: string[] = [];
	for (const r of results) {
		let header = `${statusGlyph(r, theme)} ${theme.fg("toolTitle", theme.bold(r.name))}`;
		if (!isQueued(r)) header += ` ${theme.fg("dim", collapsedStats(r))}`;
		if (showModels && r.model) header += ` ${theme.fg("dim", r.model.split("/").pop() ?? r.model)}`;
		if (isFailedResult(r)) header += `  ${theme.fg("error", failReason(r))}`;
		lines.push(truncateVisual(header, cols));

		const task = taskFirstLine(r.task);
		if (task) lines.push(`  ${truncateVisual(theme.fg("dim", task), cols - 2)}`);

		const activity = runningActivity(r, theme);
		if (activity) lines.push(`  ${truncateVisual(activity, cols - 2)}`);
	}
	if (summary) lines.push(theme.fg("dim", summary));
	if (isRunning) lines.push(theme.fg("muted", "alt+a live details"));
	return new Text(lines.join("\n"), 0, 0);
}

export function renderSpawnResult(
	result: AgentToolResult<SubagentDetails>,
	{ expanded }: { expanded: boolean },
	theme: RenderTheme,
): Text | Container {
	const details = result.details as SubagentDetails | undefined;
	if (!details || details.results.length === 0) {
		const text = result.content[0];
		return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
	}

	const mdTheme = getMarkdownTheme();

	if (expanded && !isAgentRunning(details)) {
		// Expanded (ctrl+o, after completion): final outputs only — one block
		// per agent with a quantified header and the answer rendered as
		// markdown. The per-tool timeline is the panel's job (alt+a); the
		// transcript archive does not duplicate it.
		const container = new Container();
		details.results.forEach((r, i) => {
			if (i > 0) container.addChild(new Spacer(1));
			const isError = isFailedResult(r);
			let header = `${statusGlyph(r, theme)} ${theme.fg("toolTitle", theme.bold(r.name))} ${theme.fg("dim", headerStats(r))}`;
			if (isError && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
			container.addChild(new Text(header, 0, 0));
			if (isError && r.errorMessage)
				container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
			container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));
			const finalOutput = getFinalOutput(r.messages);
			if (finalOutput.trim()) {
				container.addChild(new Spacer(1));
				container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
			} else {
				container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
			}
		});
		if (details.results.length > 1) {
			// Same shape as the collapsed header, prefixed with Total.
			const total = aggregateUsage(details.results);
			const totalTools = toolUseCount(details.results.flatMap((r) => r.messages));
			const headParts = [formatDuration(callDuration(details))];
			if (totalTools > 0) headParts.push(`${totalTools} tools`);
			if (total.output) headParts.push(`↓${formatTokens(total.output)}`);
			if (total.cost) headParts.push(`$${total.cost.toFixed(4)}`);
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("dim", `Total: ${headParts.join(" · ")}`), 0, 0));
		}
		return container;
	}

	return scoreboardView(details, theme);
}

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

export /** Terminal width for transcript lines — the render hooks get no width from the host. */
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

function formatToolCall(
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
	if (args.agents?.length) {
		let text =
			theme.fg("toolTitle", theme.bold("spawn_agents ")) +
			theme.fg("accent", `(${args.agents.length} agent${args.agents.length > 1 ? "s" : ""})`);
		for (let i = 0; i < Math.min(3, args.agents.length); i++) {
			const a = args.agents[i];
			const preview = truncateVisual(a.task, 40);
			const model = a.model ? theme.fg("dim", ` [${a.model}]`) : "";
			text += `\n  ${theme.fg("accent", a.name || `agent-${i + 1}`)}${model}${theme.fg("dim", ` ${preview}`)}`;
		}
		if (args.agents.length > 3) text += `\n  ${theme.fg("muted", `... +${args.agents.length - 3} more`)}`;
		return new Text(text, 0, 0);
	}
	return new Text(theme.fg("toolTitle", theme.bold("spawn_agents")), 0, 0);
}

function isAgentRunning(details: SubagentDetails): boolean {
	return details.results.some((r) => r.exitCode === -1);
}

/** One glanceable scoreboard line: icon, name, turns, latest activity. */
function scoreboardLine(r: SingleResult, theme: RenderTheme): string {
	const icon =
		r.exitCode === -1 && r.messages.length === 0
			? theme.fg("muted", "▢")
			: r.exitCode === -1
				? theme.fg("warning", "⏳")
				: isFailedResult(r)
					? theme.fg("error", "✗")
					: theme.fg("success", "✓");

	let activity: string;
	if (r.exitCode === -1 && r.messages.length === 0) {
		activity = theme.fg("muted", "queued");
	} else if (isFailedResult(r)) {
		const reason = (r.errorMessage || r.stderr || r.stopReason || "error").split("\n")[0];
		activity = theme.fg("error", truncateVisual(reason, 60));
	} else {
		const items = getDisplayItems(r.messages);
		const last = items[items.length - 1];
		if (!last) activity = theme.fg("muted", r.exitCode === -1 ? "starting…" : "(no output)");
		// Tool-call previews carry ANSI styling — truncateVisual keeps the
		// escape sequences intact and long commands from wrapping the line.
		else if (last.type === "toolCall") activity = truncateVisual(formatToolCall(last.name, last.args, theme.fg.bind(theme)), 60);
		else activity = theme.fg("toolOutput", truncateVisual(last.text.split("\n")[0], 60));
	}

	const turns = r.usage.turns > 0 ? theme.fg("dim", ` ${r.usage.turns}t`) : "";
	return `  ${icon} ${theme.fg("accent", r.name)}${turns}  ${activity}`;
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

	if (expanded && !isAgentRunning(details) && details.results.length === 1) {
		const r = details.results[0];
		const isError = isFailedResult(r);
		const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
		const displayItems = getDisplayItems(r.messages);
		const finalOutput = getFinalOutput(r.messages);

		const container = new Container();
		let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.name))}`;
		if (isError && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
		container.addChild(new Text(header, 0, 0));
		if (isError && r.errorMessage)
			container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
		container.addChild(new Text(theme.fg("dim", r.task), 0, 0));
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
		if (displayItems.length === 0 && !finalOutput) {
			container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
		} else {
			for (const item of displayItems) {
				if (item.type === "toolCall")
					container.addChild(
						new Text(
							theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
							0, 0,
						),
					);
			}
			if (finalOutput) {
				container.addChild(new Spacer(1));
				container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
			}
		}
		const usageStr = formatUsageStats(r.usage, r.model);
		if (usageStr) {
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
		}
		return container;
	}

	const aggregateUsage = (results: SingleResult[]) => {
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
	};

	const running = details.results.filter((r) => r.exitCode === -1).length;
	const successCount = details.results.filter((r) => r.exitCode !== -1 && !isFailedResult(r)).length;
	const failCount = details.results.filter((r) => r.exitCode !== -1 && isFailedResult(r)).length;
	const isRunning = running > 0;
	const icon = isRunning
		? theme.fg("warning", "⏳")
		: failCount > 0
			? theme.fg("warning", "◐")
			: theme.fg("success", "✓");
	const status = isRunning
		? `${successCount + failCount}/${details.results.length} done, ${running} running`
		: `${successCount}/${details.results.length} succeeded${failCount > 0 ? `, ${failCount} failed` : ""}`;

	if (expanded && !isRunning) {
		const container = new Container();
		container.addChild(
			new Text(`${icon} ${theme.fg("toolTitle", theme.bold("spawn_agents "))}${theme.fg("accent", status)}`, 0, 0),
		);

		for (const r of details.results) {
			const rIcon = isFailedResult(r) ? theme.fg("error", "✗") : theme.fg("success", "✓");
			const displayItems = getDisplayItems(r.messages);
			const finalOutput = getFinalOutput(r.messages);

			container.addChild(new Spacer(1));
			container.addChild(new Text(`${theme.fg("muted", "─── ") + theme.fg("accent", r.name)} ${rIcon}`, 0, 0));
			container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

			// Show tool calls
			for (const item of displayItems) {
				if (item.type === "toolCall") {
					container.addChild(
						new Text(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)), 0, 0),
					);
				}
			}

			// Show final output as markdown
			if (finalOutput) {
				container.addChild(new Spacer(1));
				container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
			}

			const taskUsage = formatUsageStats(r.usage, r.model);
			if (taskUsage) container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
		}

		const usageStr = formatUsageStats(aggregateUsage(details.results));
		if (usageStr) {
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
		}
		return container;
	}

	// --- scoreboard: one glanceable line per agent -----------------------
	// The panel (alt+a) is the live view; the collapsed transcript block is a
	// summary, not a competing log. Expanded (Ctrl+O, after completion) is the
	// archive.
	let text = `${icon} ${theme.fg("toolTitle", theme.bold("spawn_agents "))}${theme.fg("accent", status)}`;
	for (const r of details.results) text += `\n${scoreboardLine(r, theme)}`;
	if (!isRunning) {
		const usageStr = formatUsageStats(aggregateUsage(details.results));
		if (usageStr) text += `\n${theme.fg("dim", `Total: ${usageStr}`)}`;
		text += `\n${theme.fg("muted", "(alt+a · Ctrl+O)")}`;
	} else {
		text += `\n${theme.fg("muted", "(alt+a · live details)")}`;
	}
	return new Text(text, 0, 0);
}

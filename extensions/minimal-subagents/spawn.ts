/**
 * spawn.ts — process-spawning core for minimal-subagents
 *
 * Runs one dynamically defined agent spec as an isolated `pi -p --no-session`
 * child process in NDJSON mode: builds the CLI invocation (model / thinking /
 * tools / appended system prompt), parses the event stream into messages and
 * usage stats, and honors abort by killing the child.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";

const PER_TASK_OUTPUT_CAP = 50 * 1024;

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export interface SingleResult {
	name: string;
	task: string;
	/** -1 while the agent is still running */
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
}

export interface SubagentDetails {
	results: SingleResult[];
}

export interface AgentSpec {
	name?: string;
	systemPrompt?: string;
	task: string;
	model?: string;
	thinking?: string;
	tools?: string[];
}

export interface DispatchDefaults {
	model?: string;
	thinkingLevel?: string;
}

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

export function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

export function isFailedResult(result: SingleResult): boolean {
	// exitCode -1 means still running; a real non-zero exit (or an error/abort
	// stop reason) is the failure signal.
	return result.exitCode > 0 || result.stopReason === "error" || result.stopReason === "aborted";
}

export function getResultOutput(result: SingleResult): string {
	if (isFailedResult(result)) {
		return result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
	}
	return getFinalOutput(result.messages) || "(no output)";
}

export function truncateParallelOutput(output: string): string {
	const byteLength = Buffer.byteLength(output, "utf8");
	if (byteLength <= PER_TASK_OUTPUT_CAP) return output;

	let truncated = output.slice(0, PER_TASK_OUTPUT_CAP);
	while (Buffer.byteLength(truncated, "utf8") > PER_TASK_OUTPUT_CAP) {
		truncated = truncated.slice(0, -1);
	}
	return `${truncated}\n\n[Output truncated: ${byteLength - Buffer.byteLength(truncated, "utf8")} bytes omitted. Full output preserved in tool details.]`;
}

export async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

/**
 * Re-invoke the pi binary that is running us. Prefers the exact interpreter +
 * script pair (works for bundled binaries and npm installs); falls back to
 * `pi` on PATH when running under a generic node/bun runtime we cannot pin.
 */
function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

export async function runSpec(
	defaultCwd: string,
	dispatchDefaults: DispatchDefaults,
	spec: AgentSpec,
	displayName: string,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
): Promise<SingleResult> {
	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	// Belt-and-braces: even if the env sentinel were scrubbed, the child's
	// pi never sees the spawn_agents tool.
	args.push("--exclude-tools", "spawn_agents");
	const model = spec.model ?? dispatchDefaults.model;
	if (model) args.push("--model", model);
	const thinking = spec.thinking ?? dispatchDefaults.thinkingLevel;
	if (thinking) args.push("--thinking", thinking);
	if (spec.tools && spec.tools.length > 0) args.push("--tools", spec.tools.join(","));
	if (spec.systemPrompt?.trim()) {
		// Leading "\n" guarantees pi treats this as literal text, never a file path.
		args.push("--append-system-prompt", `\n${spec.systemPrompt}`);
	}

	const currentResult: SingleResult = {
		name: displayName,
		task: spec.task,
		exitCode: -1, // -1 = still running; real exit code set on close
		messages: [],
		stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		model,
	};

	const emitUpdate = () => {
		if (onUpdate) {
			onUpdate({
				content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" }],
				details: makeDetails([currentResult]),
			});
		}
	};

	args.push(`Task: ${spec.task}`);
	let wasAborted = false;
	let closed = false;
	let hardKillTimer: ReturnType<typeof setTimeout> | undefined;

	const exitCode = await new Promise<number>((resolve) => {
		const invocation = getPiInvocation(args);
		const proc = spawn(invocation.command, invocation.args, {
			cwd: defaultCwd,
			env: { ...process.env, PI_SUBAGENTS_CHILD: "1" },
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
			// Own process group on POSIX so abort can kill the whole tree
			// (the child spawns grandchildren like bash).
			detached: process.platform !== "win32",
		});
		let buffer = "";

		const processLine = (line: string) => {
			if (!line.trim()) return;
			let event: any;
			try {
				event = JSON.parse(line);
			} catch {
				return;
			}

			if (event.type === "message_end" && event.message) {
				const msg = event.message as Message;
				currentResult.messages.push(msg);

				if (msg.role === "assistant") {
					currentResult.usage.turns++;
					const usage = msg.usage;
					if (usage) {
						currentResult.usage.input += usage.input || 0;
						currentResult.usage.output += usage.output || 0;
						currentResult.usage.cacheRead += usage.cacheRead || 0;
						currentResult.usage.cacheWrite += usage.cacheWrite || 0;
						currentResult.usage.cost += usage.cost?.total || 0;
						currentResult.usage.contextTokens = usage.totalTokens || 0;
					}
					if (!currentResult.model && msg.model) currentResult.model = msg.model;
					if (msg.stopReason) currentResult.stopReason = msg.stopReason;
					if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
				}
				emitUpdate();
			}

			if (event.type === "tool_result_end" && event.message) {
				currentResult.messages.push(event.message as Message);
				emitUpdate();
			}
		};

		proc.stdout.on("data", (data) => {
			buffer += data.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) processLine(line);
		});

		proc.stderr.on("data", (data) => {
			currentResult.stderr += data.toString();
		});

		proc.on("close", (code) => {
			closed = true;
			if (hardKillTimer) clearTimeout(hardKillTimer);
			if (buffer.trim()) processLine(buffer);
			// A null code means death by signal — count it as failure unless we
			// aborted on purpose (the abort path throws below instead).
			resolve(code ?? 1);
		});

		proc.on("error", (err) => {
			currentResult.errorMessage = err instanceof Error ? err.message : String(err);
			resolve(1);
		});

		if (signal) {
			const killTree = (sig: NodeJS.Signals) => {
				try {
					if (process.platform === "win32" || proc.pid === undefined) proc.kill(sig);
					else process.kill(-proc.pid, sig); // negative pid = process group
				} catch {
					/* already gone */
				}
			};
			const killProc = () => {
				wasAborted = true;
				killTree("SIGTERM");
				// NOTE: proc.killed flips true once the signal is *sent*, so it
				// cannot gate the SIGKILL fallback — track `closed` instead.
				hardKillTimer = setTimeout(() => {
					if (!closed) killTree("SIGKILL");
				}, 5000);
			};
			if (signal.aborted) killProc();
			else signal.addEventListener("abort", killProc, { once: true });
		}
	});

	currentResult.exitCode = exitCode;
	if (wasAborted) throw new Error("Subagent was aborted");
	return currentResult;
}

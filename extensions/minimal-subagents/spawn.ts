/**
 * spawn.ts — process-spawning core for minimal-subagents
 *
 * Runs one dynamically defined agent spec as an isolated `pi -p --no-session`
 * child process in NDJSON mode: builds the CLI invocation (model / thinking /
 * tools / appended system prompt), parses the event stream into messages and
 * usage stats, and honors abort by killing the child. At most MAX_CONCURRENCY
 * children run at once across every spawn_agents call: parallel calls queue
 * instead of multiplying processes.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";

const OUTPUT_CAP = 50 * 1024;
const MAX_CONCURRENCY = 4;

// ---- shared child-process limiter -------------------------------------------
// Children are whole pi processes, so the cap belongs to the extension, not to
// one call: several spawn_agents calls in one message queue here.

let running = 0;
const waiting: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

async function acquireSlot(signal: AbortSignal | undefined): Promise<void> {
	if (signal?.aborted) throw new Error("Subagent was aborted");
	if (running < MAX_CONCURRENCY) {
		running++;
		return;
	}
	await new Promise<void>((resolve, reject) => {
		const entry = { resolve, reject };
		waiting.push(entry);
		signal?.addEventListener(
			"abort",
			() => {
				const index = waiting.indexOf(entry);
				if (index === -1) return; // already handed a slot
				waiting.splice(index, 1);
				reject(new Error("Subagent was aborted"));
			},
			{ once: true },
		);
	});
}

function releaseSlot(): void {
	// Hand the slot straight to the next waiter instead of decrementing and
	// letting it race another acquirer.
	const next = waiting.shift();
	if (next) next.resolve();
	else running--;
}

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

/** Queued for a child slot, running in its own process, or exited. */
export type AgentPhase = "queued" | "running" | "finished";

export interface SingleResult {
	name: string;
	task: string;
	/** "queued" waits for a slot; "finished" is exactly `exitCode !== -1`. */
	phase: AgentPhase;
	/** -1 until the child exits */
	exitCode: number;
	/** Unix ms at agent start. */
	startedAt: number;
	/** Unix ms at agent end; undefined while running. */
	endedAt?: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
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

type OnUpdateCallback = (partial: AgentToolResult<SingleResult>) => void;

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

/** "completed" / "failed (stopReason)" — shared by the tool result and the panel. */
export function failureStatus(result: SingleResult): string {
	if (!isFailedResult(result)) return "completed";
	return `failed${result.stopReason && result.stopReason !== "end" ? ` (${result.stopReason})` : ""}`;
}

export function isFailedResult(result: SingleResult): boolean {
	// exitCode -1 means still running; a positive exit code or an error/abort
	// stop reason is the failure signal.
	return result.exitCode > 0 || result.stopReason === "error" || result.stopReason === "aborted";
}

export function getResultOutput(result: SingleResult): string {
	if (isFailedResult(result)) {
		return result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
	}
	return getFinalOutput(result.messages) || "(no output)";
}

export function truncateOutput(output: string): string {
	const byteLength = Buffer.byteLength(output, "utf8");
	if (byteLength <= OUTPUT_CAP) return output;

	let truncated = output.slice(0, OUTPUT_CAP);
	while (Buffer.byteLength(truncated, "utf8") > OUTPUT_CAP) {
		truncated = truncated.slice(0, -1);
	}
	return `${truncated}\n\n[Output truncated at 50 KB]`;
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
		phase: "running", // not published until a slot is held, so this never lies
		exitCode: -1, // -1 = still running; real exit code set on close
		startedAt: 0, // stamped once the child actually starts
		messages: [],
		stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		model,
	};

	const emitUpdate = () => {
		if (onUpdate) {
			onUpdate({
				content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" }],
				details: currentResult,
			});
		}
	};

	args.push(`Task: ${spec.task}`);
	let wasAborted = false;
	let closed = false;
	let hardKillTimer: ReturnType<typeof setTimeout> | undefined;

	await acquireSlot(signal);
	// The slot may have been handed over just as the caller aborted; never
	// spawn for a dead call.
	if (signal?.aborted) {
		releaseSlot();
		throw new Error("Subagent was aborted");
	}
	// Queue time is not agent time: the clock starts with the process.
	currentResult.startedAt = Date.now();
	let exitCode: number;
	try {
		exitCode = await new Promise<number>((resolve) => {
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
			// Flip the panel/transcript from "queued" to "running" now, not when
			// the child's first message arrives — booting a pi process takes
			// seconds with no output.
			emitUpdate();
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
	} finally {
		releaseSlot();
	}

	currentResult.exitCode = exitCode;
	currentResult.phase = "finished";
	currentResult.endedAt = Date.now();
	if (wasAborted) throw new Error("Subagent was aborted");
	return currentResult;
}

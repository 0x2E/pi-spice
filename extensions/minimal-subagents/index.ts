/**
 * minimal-subagents — create sub-agents dynamically and run them in parallel
 *
 * Adapted from pi's official example extension `examples/extensions/subagent`
 * (pi v0.84.4, MIT License, https://github.com/earendil-works/pi), reshaped:
 * the agent is defined inline per invocation (no predefined .md files) and the
 * tool takes one flat spec, so parallel work is several calls in one assistant
 * message — pi already runs those concurrently — instead of a wrapper array.
 * Each spec can pick its own model, thinking level and tool allowlist; omitted
 * fields inherit the parent session's. The call blocks until the agent
 * finishes. Nesting is blocked by an environment sentinel plus
 * `--exclude-tools spawn_agents`; the child-process concurrency limit is shared
 * across calls (spawn.ts), and the alt+a panel accumulates every agent this
 * session (panel.ts).
 *
 * Process spawning lives in spawn.ts; TUI rendering in render.ts and panel.ts.
 *
 * Install: pi install npm:@pi-spice/minimal-subagents
 * Quick test: pi -e ./extensions/minimal-subagents/
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { failureStatus, getResultOutput, isFailedResult, runSpec, truncateOutput, type SingleResult } from "./spawn.ts";
import { renderSpawnCall, renderSpawnResult } from "./render.ts";
import { hasAgents, openAgentPanel, upsertAgent } from "./panel.ts";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

const SpawnAgentParams = Type.Object({
	name: Type.Optional(
		Type.String({
			description:
				'Short role label used as the result heading ("### [scout]"). Default: agent-1, agent-2, … per session.',
		}),
	),
	systemPrompt: Type.Optional(
		Type.String({
			description:
				"Standing rules appended to the agent's system prompt — role, constraints, output format. Put the assignment in task.",
		}),
	),
	task: Type.String({
		minLength: 1,
		description:
			'What the agent must accomplish. It cannot see this conversation: give the goal, the paths, what you ruled out, and the output you want back ("report in under 200 words").',
	}),
	model: Type.Optional(
		Type.String({
			description:
				'Model as "provider/model-id", e.g. "anthropic/claude-haiku-4-5". Omit to inherit the parent session\'s model.',
		}),
	),
	thinking: Type.Optional(
		StringEnum(THINKING_LEVELS, {
			description: "Reasoning effort. Omit to inherit the parent session's level.",
		}),
	),
	tools: Type.Optional(
		Type.Array(Type.String(), {
			description:
				'Tool names to allow, e.g. ["read","grep","find","ls"] for a read-only scout. Omit for the child\'s configured tool set — grep, find and ls are opt-in.',
		}),
	),
});

/** Headings and panel tabs are keyed by name, so every call claims a distinct one. */
let agentSeq = 0;
const usedNames = new Set<string>();

function claimName(preferred?: string): string {
	const base = preferred?.trim() || `agent-${++agentSeq}`;
	let name = base;
	for (let suffix = 2; usedNames.has(name); suffix++) name = `${base}-${suffix}`;
	usedNames.add(name);
	return name;
}

export default function (pi: ExtensionAPI) {
	// Nesting guard: sub-agent processes run with PI_SUBAGENTS_CHILD=1 (set in
	// runSpec's spawn env). Refuse to register the tool there, so sub-agents
	// cannot spawn their own sub-agents — while keeping every other extension
	// available to them.
	if (process.env.PI_SUBAGENTS_CHILD) return;

	pi.registerTool({
		name: "spawn_agents",
		label: "Spawn agent",
		description: [
			"Run an agent in an isolated pi process with its own context window; it starts with no knowledge of this conversation.",
			"The call blocks until the agent finishes, then returns its final message under a ### [name] heading.",
			"To run agents in parallel, issue one call per agent in the same message.",
		].join(" "),
		promptGuidelines: [
			"Use spawn_agents for an open-ended, multi-step question worth its own context window; use read, grep or find for a known file or symbol.",
			"Write each task as a self-contained brief — goal, paths, what you already ruled out, the output you want back. The agent cannot ask questions, so a terse command-style task produces shallow work.",
			"Launch parallel work as several spawn_agents calls in one message, and keep those tasks file-disjoint: agents share this working directory.",
			"spawn_agents returns the agent's final message only, and results come back to you rather than to the user — summarize what matters in your reply.",
		],
		parameters: SpawnAgentParams,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const name = claimName(params.name);
			const dispatchDefaults = {
				model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
				thinkingLevel: ctx.thinkingLevel,
			};

			// Placeholder until the child reports: the panel and the tool row show
			// "queued" (then "running") the moment the call starts, instead of "no
			// data" while a child waits for a slot or takes seconds to boot.
			let current: SingleResult = {
				name,
				task: params.task,
				phase: "queued", // waiting for a child slot; render.ts and the panel say so
				exitCode: -1,
				startedAt: Date.now(),
				messages: [],
				stderr: "",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
			};
			const publish = () => {
				upsertAgent(toolCallId, current);
				onUpdate?.({ content: [{ type: "text", text: current.phase === "queued" ? "queued…" : "running…" }], details: current });
			};
			publish();

			try {
				current = await runSpec(ctx.cwd, dispatchDefaults, params, name, signal, (partial) => {
					if (partial.details) {
						current = partial.details;
						publish();
					}
				});
			} catch (err) {
				// An abort keeps whatever the child produced, marked as such, rather
				// than discarding finished work behind a thrown tool error.
				if (!signal?.aborted) throw err;
				current = { ...current, phase: "finished", exitCode: 1, stopReason: "aborted", endedAt: Date.now() };
			}
			publish();

			const status = failureStatus(current);
			const usage =
				current.usage.turns > 0 || current.usage.cost > 0
					? `\n\n(${current.usage.turns} turns, $${current.usage.cost.toFixed(4)})`
					: "";
			return {
				content: [
					{
						type: "text",
						text: `### [${current.name}] ${status}\n\n${truncateOutput(getResultOutput(current))}${usage}`,
					},
				],
				details: current,
				isError: isFailedResult(current),
			};
		},

		renderCall: renderSpawnCall,
		renderResult: renderSpawnResult,
	});

	pi.registerShortcut("alt+a", {
		description: "Toggle the sub-agent details panel (tabs per agent, full timeline); alt+a or Esc closes it",
		handler: (ctx) => {
			// No run yet → pi's notify message, not an empty overlay stuck in the
			// corner.
			if (!hasAgents()) {
				ctx.ui.notify("No sub-agent data yet — run spawn_agents first", "info");
				return;
			}
			openAgentPanel(ctx);
		},
	});
}

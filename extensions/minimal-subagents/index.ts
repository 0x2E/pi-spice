/**
 * minimal-subagents — spawn dynamically created sub-agents, in parallel
 *
 * Fork of the official pi example extension `examples/extensions/subagent`
 * (pi v0.84.4, MIT License, https://github.com/earendil-works/pi), reshaped:
 * agents are defined inline per invocation (no predefined .md files), there is
 * a single `{ agents: [spec...] }` mode (no chain/orchestration), and nesting
 * is prevented via an environment sentinel. The parent blocks until every
 * sub-agent finished; each spec can pick its own model, thinking level and
 * tool allowlist, inheriting the parent session's model/thinking by default.
 *
 * Process spawning lives in spawn.ts, TUI rendering in render.ts.
 *
 * Install: pi install npm:@pi-spice/minimal-subagents
 * Quick test: pi -e ./extensions/minimal-subagents
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	getResultOutput,
	isFailedResult,
	mapWithConcurrencyLimit,
	runSpec,
	truncateParallelOutput,
	type SingleResult,
	type SubagentDetails,
} from "./spawn.ts";
import { renderSpawnCall, renderSpawnResult } from "./render.ts";

const MAX_AGENTS = 8;
const MAX_CONCURRENCY = 4;

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

const AgentSpecSchema = Type.Object({
	name: Type.Optional(Type.String({ description: "Display label for this agent (results only). Default: agent-<index>" })),
	systemPrompt: Type.Optional(
		Type.String({
			description:
				"Role, constraints and output-format rules for this agent (appended to the child's system prompt). Put standing instructions here, not the assignment.",
		}),
	),
	task: Type.String({ description: "The concrete assignment this agent must complete" }),
	model: Type.Optional(
		Type.String({ description: 'Model for this agent, e.g. "anthropic/claude-haiku-4-5". Default: inherit parent session model' }),
	),
	thinking: Type.Optional(
		StringEnum(THINKING_LEVELS, {
			description: "Reasoning effort for this agent. Default: inherit parent session thinking level",
		}),
	),
	tools: Type.Optional(
		Type.Array(Type.String(), {
			description: 'Tool allowlist for this agent, e.g. ["read","grep","find","ls"]. Default: child default tools',
		}),
	),
});

const SpawnAgentsParams = Type.Object({
	agents: Type.Array(AgentSpecSchema, {
		minItems: 1,
		maxItems: MAX_AGENTS,
		description: `Agents to create and run in parallel (1-${MAX_AGENTS}). A single task is an array of one. All agents run concurrently; the tool returns when every agent finished.`,
	}),
});

export default function (pi: ExtensionAPI) {
	// Nesting guard: sub-agent processes run with PI_SUBAGENTS_CHILD=1 (set in
	// runSpec's spawn env). Refuse to register the tool there, so sub-agents
	// cannot spawn their own sub-agents — while keeping every other extension
	// available to them.
	if (process.env.PI_SUBAGENTS_CHILD) return;

	pi.registerTool({
		name: "spawn_agents",
		label: "Spawn agents",
		description: [
			"Create sub-agents dynamically and run them in parallel, each in an isolated pi process.",
			"Each agent is defined inline: systemPrompt (role/constraints) + task (assignment), with optional model, thinking level and tool allowlist; unset fields inherit the parent session.",
			"Blocks until all agents finish, then returns each agent's final output.",
			"The parent's working directory and project context (AGENTS.md) are shared; agents cannot spawn further sub-agents.",
		].join(" "),
		parameters: SpawnAgentsParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (params.agents.length > MAX_AGENTS) {
				return {
					content: [{ type: "text", text: `Too many agents (${params.agents.length}). Max is ${MAX_AGENTS}.` }],
					details: { results: [] },
				};
			}

			const dispatchDefaults = {
				model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
				thinkingLevel: ctx.thinkingLevel,
			};

			const makeDetails = (results: SingleResult[]): SubagentDetails => ({ results });

			// Track all results for streaming updates
			const allResults: SingleResult[] = new Array(params.agents.length);

			// Initialize placeholder results
			for (let i = 0; i < params.agents.length; i++) {
				allResults[i] = {
					name: params.agents[i].name ?? `agent-${i + 1}`,
					task: params.agents[i].task,
					exitCode: -1, // -1 = still running
					messages: [],
					stderr: "",
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
				};
			}

			const emitParallelUpdate = () => {
				if (onUpdate) {
					const running = allResults.filter((r) => r.exitCode === -1).length;
					const done = allResults.filter((r) => r.exitCode !== -1).length;
					onUpdate({
						content: [
							{ type: "text", text: `Running: ${done}/${allResults.length} done, ${running} running...` },
						],
						details: makeDetails([...allResults]),
					});
				}
			};

			const results = await mapWithConcurrencyLimit(params.agents, MAX_CONCURRENCY, async (spec, index) => {
				const result = await runSpec(
					ctx.cwd,
					dispatchDefaults,
					spec,
					allResults[index].name,
					signal,
					(partial) => {
						if (partial.details?.results[0]) {
							allResults[index] = partial.details.results[0];
							emitParallelUpdate();
						}
					},
					makeDetails,
				);
				allResults[index] = result;
				emitParallelUpdate();
				return result;
			});

			const successCount = results.filter((r) => !isFailedResult(r)).length;
			const summaries = results.map((r) => {
				const output = truncateParallelOutput(getResultOutput(r));
				const status = isFailedResult(r)
					? `failed${r.stopReason && r.stopReason !== "end" ? ` (${r.stopReason})` : ""}`
					: "completed";
				return `### [${r.name}] ${status}\n\n${output}`;
			});
			return {
				content: [
					{
						type: "text",
						text: `${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}`,
					},
				],
				details: makeDetails(results),
				isError: successCount === 0,
			};
		},

		renderCall: renderSpawnCall,
		renderResult: renderSpawnResult,
	});
}

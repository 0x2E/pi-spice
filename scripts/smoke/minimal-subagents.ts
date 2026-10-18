// Smoke harness for @pi-spice/minimal-subagents — run via `npm run smoke`.
//
// Loads the extension with a stubbed ExtensionAPI and asserts the model-facing
// contract: one tool with a flat, single-agent schema (no `agents` wrapper),
// wording that makes "omit to inherit" the only way to inherit a model or
// thinking level, a description at pi's native density, and renderers that
// handle one agent. The panel and the child-process limiter are driven through
// a real session instead — they have no harness seam.

import { cpSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Identity theme: rendered text is asserted as the terminal shows it. */
const theme = {
	fg: (_c: string, t: string) => t,
	bold: (t: string) => t,
};

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? ` — ${detail}` : ""}`);
	if (!ok) failures.push(name);
};

// ---- load the extension from a copy with an ESM package.json ----
// The copy keeps relative imports (./spawn.ts and friends) intact; only
// `type: module` is added so Node's type stripping does not warn.
const root = new URL("../..", import.meta.url).pathname;
// Outside the repo (Node refuses type stripping inside node_modules) with a
// symlink back so the copy still resolves the repo's installed pi/typebox
// packages; `type: module` on the copied manifest silences the reparse warning.
const tmp = mkdtempSync(join(tmpdir(), "minimal-subagents-smoke-"));
symlinkSync(join(root, "node_modules"), join(tmp, "node_modules"), "dir");
cpSync(join(root, "extensions/minimal-subagents"), join(tmp, "ext"), { recursive: true });
writeFileSync(join(tmp, "ext/package.json"), '{"type":"module"}');
const mod = (await import(join(tmp, "ext/index.ts"))) as { default: (api: any) => void };

const tools: any[] = [];
const shortcuts: string[] = [];
delete process.env.PI_SUBAGENTS_CHILD;
mod.default({
	registerTool: (tool: any) => tools.push(tool),
	registerShortcut: (key: string) => shortcuts.push(key),
});

const tool = tools[0] ?? {};
const params = tool.parameters ?? {};
const props = params.properties ?? {};

// ---- 1. one flat schema, no agents wrapper ----
check("registers exactly one tool", tools.length === 1, `got ${tools.length}`);
check("tool is spawn_agents", tool.name === "spawn_agents", String(tool.name));
check(
	"params expose the six spec fields",
	Object.keys(props).sort().join(",") === "model,name,systemPrompt,task,thinking,tools",
	Object.keys(props).join(","),
);
check("no agents wrapper", !("agents" in props));
check("task is the only required field", JSON.stringify(params.required ?? []) === '["task"]', JSON.stringify(params.required));

// ---- 2. omit-to-inherit wording on the inherited fields ----
const desc = (field: string) => String(props[field]?.description ?? "");
check('model says "Omit to inherit"', desc("model").includes("Omit to inherit"), desc("model"));
check('thinking says "Omit to inherit"', desc("thinking").includes("Omit to inherit"), desc("thinking"));
check(
	"tools says omit for the configured set",
	desc("tools").includes("Omit for the child's configured tool set"),
	desc("tools"),
);
check("tools flags the search tools as opt-in", /grep, find and ls are opt-in/.test(desc("tools")), desc("tools"));
check(
	"no negative inherit rules (they re-teach the mistake)",
	![desc("model"), desc("thinking"), desc("tools")].some((d) => /never pass|is not a value/.test(d)),
);
check(
	"thinking constrains the levels in the schema",
	(props.thinking?.enum ?? []).join(",") === "off,minimal,low,medium,high,xhigh,max",
	JSON.stringify(props.thinking?.enum),
);

// ---- 3. description at pi's native density ----
const summary = String(tool.description ?? "");
check("description is one paragraph", !summary.includes("\n"), `${summary.split("\n").length} lines`);
check("description stays under 400 chars", summary.length <= 400, `${summary.length} chars`);
check("description names the isolation", /isolated pi process/.test(summary), summary);
check("description names the result shape", summary.includes("### [name]"), summary);
check("description states it blocks", /blocks until/.test(summary), summary);
check("four prompt guidelines", (tool.promptGuidelines ?? []).length === 4, JSON.stringify(tool.promptGuidelines));
check("shortcut still registered", shortcuts.includes("alt+a"), JSON.stringify(shortcuts));

// ---- 4. renderers: one agent per call ----
const render = (await import(join(tmp, "ext/render.ts"))) as any;
const { renderSpawnCall, renderSpawnResult } = render;
const { failureStatus } = (await import(join(tmp, "ext/spawn.ts"))) as any;
const rows = (comp: any, w = 100): string[] =>
	(comp.render(w) as string[]).map((line) => line.trim()).filter(Boolean);
/** Un-trimmed rows: right-alignment is only visible with padding intact. */
const rawRows = (comp: any, w = 100): string[] => comp.render(w) as string[];

const agent = (over: Record<string, unknown> = {}) => ({
	name: "scout",
	task: "Find every call site of runSpec",
	phase: "finished",
	exitCode: 0,
	startedAt: Date.now() - 7000,
	endedAt: Date.now(),
	messages: [],
	stderr: "",
	usage: { input: 4100, output: 70, cacheRead: 900, cacheWrite: 0, cost: 0.0003, contextTokens: 5000, turns: 2 },
	model: "anthropic/claude-haiku-4-5",
	...over,
});
const call = (over: Record<string, unknown> = {}) => rows(renderSpawnCall(over, theme));
const result = (over: Record<string, unknown>, expanded = false) =>
	rows(renderSpawnResult({ content: [{ type: "text", text: "x" }], details: agent(over) }, { expanded }, theme));
const resultRaw = (over: Record<string, unknown>, expanded = false, width = 100) =>
	rawRows(renderSpawnResult({ content: [{ type: "text", text: "x" }], details: agent(over) }, { expanded }, theme), width);

const slot = renderSpawnCall({ name: "scout", task: "t" }, theme);
check("call slot draws nothing (the result owns the row)", (slot.render(100) as string[]).length === 0);
check("call slot is reusable across renders", (slot.render(100) as string[]).length === 0);

const done = result({});
check(
	"status follows the title without padding",
	done[0] === "subagent scout  ✓ 7s · ↓70 · $0.0003",
	JSON.stringify(done[0]),
);
check("task sits under the header", done[1] === "Find every call site of runSpec", JSON.stringify(done));

const longName = result({ name: "a-very-long-agent-role-label" });
check(
	"a long header truncates instead of wrapping",
	longName.length >= 2 && longName[0].length <= 78,
	`${longName[0].length}: ${JSON.stringify(longName[0])}`,
);
check("nothing else follows the header and task when finished", done.length === 2, JSON.stringify(done));

const queued = result({ phase: "queued", exitCode: -1, endedAt: undefined, messages: [] });
check("queued agent says so on the header", queued[0].endsWith("queued") && !queued[0].includes("✻"), JSON.stringify(queued));

const running = result({ phase: "running", exitCode: -1, endedAt: undefined, messages: [] });
check(
	"running agent shows activity and the panel hint",
	running[0].includes("✻") && running.some((l) => l.includes("starting…")) && running.some((l) => l.includes("alt+a")),
	JSON.stringify(running),
);
check("finished agent drops the hint", !done.some((l) => l.includes("alt+a")), JSON.stringify(done));

const failed = result({ exitCode: 1, stopReason: "error", errorMessage: "model not found" });
check(
	"failure reason gets its own line",
	failed[0].includes("✗") && !failed[0].includes("model not found") && failed.some((l) => l === "model not found"),
	JSON.stringify(failed),
);

check(
	"failureStatus labels both shared call sites",
	failureStatus({ exitCode: 1, stopReason: "error" }) === "failed (error)" &&
		failureStatus({ exitCode: 1, stopReason: "aborted" }) === "failed (aborted)" &&
		failureStatus({ exitCode: 0, stopReason: "end" }) === "completed",
	[failureStatus({ exitCode: 1, stopReason: "error" }), failureStatus({ exitCode: 0, stopReason: "end" })].join(" / "),
);

const expanded = result(
	{
		messages: [
			{ role: "assistant", content: [{ type: "text", text: "one call site: spawn.ts:156" }] },
		],
	},
	true,
);
check(
	"expanded block shows the task and final output",
	expanded.some((l) => l.includes("Task: Find every call")) && expanded.some((l) => l.includes("one call site")),
	JSON.stringify(expanded),
);

// ---- 5. panel: tabs across calls, eviction, and narrow tab bars ----
// The panel is module state keyed by toolCallId: a call re-publishes its own
// entry on every child event, and eviction must not drop a running tab (it
// would reappear at the end on its next update) or the one just finished.
const panel = (await import(join(tmp, "ext/panel.ts"))) as any;
const finishedAgent = (name: string) => ({ ...agent({ name }) });
const liveAgent = (name: string) => ({ ...agent({ name, phase: "running", exitCode: -1, endedAt: undefined }) });
const names = () => (panel.listAgents() as any[]).map((r) => r.name);

for (let i = 1; i <= 9; i++) panel.upsertAgent(`done-${i}`, finishedAgent(`a${i}`));
check("nine finished agents leave eight tabs", panel.listAgents().length === 8, names().join(","));
check("the oldest finished tab is the one evicted", !names().includes("a1") && names().includes("a9"), names().join(","));

for (let i = 1; i <= 9; i++) panel.upsertAgent(`live-${i}`, liveAgent(`l${i}`));
check(
	"live tabs survive eviction and may exceed the cap",
	panel.listAgents().length === 9 && names().every((n: string) => n.startsWith("l")),
	names().join(","),
);

panel.upsertAgent("live-1", finishedAgent("l1"));
check("a just-finished tab is not evicted by its own update", names().includes("l1"), names().join(","));

panel.upsertAgent("live-2", finishedAgent("l2"));
check("the next finish evicts the older finished tab", !names().includes("l1") && names().includes("l2"), names().join(","));

panel.upsertAgent("live-3", finishedAgent("l3"));
check("re-publishing a call replaces its tab", names().filter((n: string) => n === "l3").length === 1, names().join(","));

// A tab bar wider than the panel must window around the active tab instead of
// letting later tabs fall off the right edge.
const slotLabels = Array.from({ length: 12 }, (_, i) => `${i + 1}✓`);
const measure = (label: string) => label.length;
const wholeBar = panel.fitTabs(slotLabels, 3, 100, measure);
check("tab bar shows every tab when it fits", wholeBar.from === 0 && wholeBar.to === 12, JSON.stringify(wholeBar));
const tailBar = panel.fitTabs(slotLabels, 11, 20, measure);
check("narrow tab bar windows around a later tab", tailBar.from > 0 && tailBar.to === 12, JSON.stringify(tailBar));
const midBar = panel.fitTabs(slotLabels, 5, 20, measure);
check("the window always contains the active tab", midBar.from <= 5 && midBar.to > 5, JSON.stringify(midBar));
const tightBar = panel.fitTabs(slotLabels, 5, 10, measure);
check("a smaller budget never widens the window", tightBar.to - tightBar.from <= midBar.to - midBar.from, JSON.stringify(tightBar));

if (failures.length > 0) {
	console.error(`\n${failures.length} failure(s)`);
	process.exit(1);
}
console.log("\nall green");

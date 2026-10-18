// Smoke harness for @pi-spice/thinking-preview — run via `npm run smoke`.
//
// Loads the extension with type-only imports stripped and drives the thinking
// transformer through the shapes pi actually produces: preview and expanded
// forms, escaping, width clipping — and the thinking timing chain
// (thinking_start/delta/end events; phase-only display: whole seconds while
// streaming, exact when the phase closes, line-count fallback when untimed).
// Plus contract scans of the installed packages for what timing keys on:
// pi's trim + "\n\n" join of thinking runs, and pi-ai's thinking event
// types. Any failure exits 1.
//
// The scans read node_modules directly: the pi package's `exports` field
// blocks deep module imports, but not file reads — and the harness must not
// need a running pi.

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A Markdown transformer as pi registers it. */
type Transformer = (markdown: string, context: { messageType: string; isStreaming: boolean; availableWidth: number }) => string;
/** Command/shortcut options. */
type CommandOptions = { handler: (...args: any[]) => any };
/** Event handler as the extension registers it. */
type Handler = (event: any, ctx?: any) => any;
/**
 * The extension API surface the harness stubs. Everything crossing this
 * boundary is `any` on purpose: the module under test is loaded with its type
 * imports stripped, so its own types never reach the harness.
 */
interface ApiDouble {
	registerMarkdownTransformer(transformer: Transformer): void;
	registerShortcut(key: string, options: CommandOptions): void;
	registerCommand(name: string, options: CommandOptions): void;
	on(event: string, handler: Handler): void;
}

const root = new URL("../..", import.meta.url).pathname;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? ` — ${detail}` : ""}`);
	if (!ok) failures.push(name);
};

// ---- load the extension with type-only imports stripped ----
const tmp = mkdtempSync(join(tmpdir(), "thinking-preview-smoke-"));
writeFileSync(join(tmp, "package.json"), '{"type":"module"}');
const stripped = readFileSync(join(root, "extensions/thinking-preview/index.ts"), "utf8")
	.replace(/^import type[\s\S]*?from "[^"]+";\n/gm, "");
writeFileSync(join(tmp, "index.ts"), stripped);
const mod = (await import(join(tmp, "index.ts"))) as { default: (api: ApiDouble) => void };

const transformers: Transformer[] = [];
const handlers = new Map<string, Handler>();
const commands = new Map<string, CommandOptions>();
const notifications: string[] = [];
let relabels = 0;
mod.default({
	registerMarkdownTransformer: (t) => transformers.push(t),
	registerShortcut: () => {},
	registerCommand: (n, o) => commands.set(n, o),
	on: (ev, h) => handlers.set(ev, h),
});
const tf = transformers[0];
const md = (t: string, s = false, w = 80) => tf(t, { messageType: "assistant-thinking", isStreaming: s, availableWidth: w });

// ---- 1. preview forms ----
{
	check("non-thinking passes through", tf("**hi**", { messageType: "user", isStreaming: true, availableWidth: 80 }) === "**hi**");
	check("empty passes through", md("  ") === "  ");
	const three = md("one\ntwo\nthree\nfour", true).split("\n");
	check("preview = status + last two lines", three.length === 3 && three[1].includes("three") && three[2].includes("four"), JSON.stringify(three));
	check("untimed status falls back to line count", three[0].includes("· 4 lines"));
	check("markdown escaped in tail", md("run `x` *y*", true).split("\n")[1].includes("\\`x\\`"));
	// The trailing backslash is a hard-break marker — rendered, the line is
	// the bar (2) + the 10-char clip.
	check("narrow width clips status", md("long line here", false, 12).split("\n")[0].replace(/\\$/, "").length <= 12);
}

// ---- 2. thinking timing: phase-only, live seconds, close, fallback ----
{
	const realNow = Date.now;
	/** Fire a message event with its arrival backdated `agoMs` (the clocks are stamped on arrival). */
	const fire = (ev: string, deltaType: string | undefined, content: unknown[], agoMs: number) => {
		if (agoMs !== undefined) Date.now = () => realNow() - agoMs;
		try {
			handlers.get(ev)!({
				type: ev,
				message: { role: "assistant", content },
				...(deltaType ? { assistantMessageEvent: { type: deltaType } } : {}),
			});
		} finally {
			Date.now = realNow;
		}
	};
	const think = (t: string) => [{ type: "thinking", thinking: t }];

	check("untimed falls back to line count", md("beta\ntwo", false).split("\n")[0].includes("· 2 lines"));

	// Phase opened 8.4s ago and still streaming: whole seconds, floored — the
	// close below must never step the number backward.
	fire("message_update", "thinking_start", think(""), 8400);
	fire("message_update", "thinking_delta", think("alpha thinking"), 8400);
	const live = md("alpha thinking", true).split("\n")[0];
	check("streaming floors to whole seconds", live.includes("· 8s"), live);

	// The phase closed 5.9s ago while the response went on generating text:
	// the shown time is the phase (8.4 − 5.9 = 2.5s), never the response.
	fire("message_update", "thinking_end", think("alpha thinking"), 5900);
	const done = md("alpha thinking", false).split("\n")[0];
	check("closed run shows the phase time only", done.includes("· 2.5s"), done);

	// Closing at the instant the live value was read never steps backward:
	// the live counter floors, the closed value is exact.
	fire("message_update", "thinking_start", think(""), 8400);
	fire("message_update", "thinking_delta", think("monotonic check"), 8400);
	const liveStep = md("monotonic check", true).split("\n")[0];
	fire("message_update", "thinking_end", think("monotonic check"), 0);
	const closedStep = md("monotonic check", false).split("\n")[0];
	check("live floors, closed is exact", liveStep.includes("· 8s") && closedStep.includes("· 8.4s"), `${liveStep} | ${closedStep}`);

	// Regression (openai-completions providers): thinking_end fires only after
	// the whole stream, so the first text event must close the phase — the
	// counter must not run on through the text generation.
	fire("message_update", "thinking_start", think(""), 10000);
	fire("message_update", "thinking_delta", think("glm style run"), 10000);
	fire("message_update", "text_delta", [...think("glm style run"), { type: "text", text: "Once" }], 2000);
	const glmLive = md("glm style run", true).split("\n")[0];
	check("text phase closes the phase (openai-completions)", glmLive.includes("· 8.0s"), glmLive);
	// The stream-end thinking_end arrives late and must not extend the phase.
	fire("message_update", "thinking_end", think("glm style run"), 0);
	check("late thinking_end does not extend", md("glm style run", false).split("\n")[0].includes("· 8.0s"));

	// An aborted phase (no thinking_end) closes at the response's end.
	fire("message_update", "thinking_start", think(""), 7000);
	fire("message_update", "thinking_delta", think("aborted mid-thought"), 7000);
	fire("message_end", undefined, think("aborted mid-thought"), 1200);
	check("abort closes at response end", md("aborted mid-thought", false).split("\n")[0].includes("· 5.8s"), md("aborted mid-thought", false));

	// Two runs whose thinking text opens identically must keep their own times:
	// the record is keyed by the whole text, not a shared prefix.
	const shared = "The user wants me to fix the failing smoke test in collapse-blocks. I'll read the harness.";
	fire("message_update", "thinking_start", think(""), 20000);
	fire("message_update", "thinking_delta", think(`${shared} First body.`), 20000);
	fire("message_update", "thinking_end", think(`${shared} First body.`), 11600);
	fire("message_update", "thinking_start", think(""), 4000);
	fire("message_update", "thinking_delta", think(`${shared} Second body.`), 4000);
	fire("message_update", "thinking_end", think(`${shared} Second body.`), 1000);
	check("shared opening: first run keeps its time", md(`${shared} First body.`, false).includes("· 8.4s"), md(`${shared} First body.`, false));
	check("shared opening: second run keeps its own", md(`${shared} Second body.`, false).includes("· 3.0s"), md(`${shared} Second body.`, false));

	// A stray reasoning chunk after the phase closed (openai-completions emits
	// reasoning per chunk with no latch) must not reopen or zero the time.
	fire("message_update", "thinking_start", think(""), 9000);
	fire("message_update", "thinking_delta", think("mixed provider stream"), 9000);
	fire("message_update", "text_delta", [...think("mixed provider stream"), { type: "text", text: "Answer" }], 5000);
	fire("message_update", "thinking_delta", think("mixed provider stream"), 200);
	check("stray delta after close keeps the time", md("mixed provider stream", false).includes("· 4.0s"), md("mixed provider stream", false));

	// Long sessions: one record per run, so many runs never evict real timings.
	const longBodies = Array.from({ length: 12 }, (_, i) => `run ${i} ` + "y".repeat(80));
	for (const body of longBodies) {
		fire("message_update", "thinking_start", think(""), 10000);
		// Grow the text the way a stream does: many distinct prefixes, one run.
		for (let end = 3; end < body.length; end += 3) fire("message_update", "thinking_delta", think(body.slice(0, end)), 10000);
		fire("message_update", "thinking_end", think(body), 5000);
	}
	check("many runs keep the earliest timing", md(longBodies[0], false).includes("· 5.0s"), md(longBodies[0], false));
	check("many runs keep the latest timing", md(longBodies[11], false).includes("· 5.0s"), md(longBodies[11], false));

	// Redacted thinking arrives complete at start and emits no deltas.
	fire("message_update", "thinking_start", think("[Reasoning redacted]"), 6000);
	fire("message_update", "thinking_end", think("[Reasoning redacted]"), 4000);
	check("redacted run is timed", md("[Reasoning redacted]", false).includes("· 2.0s"), md("[Reasoning redacted]", false));

	// session_start clears the in-memory table; untimed blocks fall back to lines.
	handlers.get("session_start")!({}, {});
	check("session_start clears timings", md("alpha thinking", false).includes("· 1 line ·"));
}

// ---- 3. expansion toggle: full text, notification, relabel re-render ----
{
	await commands.get("thinking-preview")!.handler("", { ui: { notify: (m: string) => notifications.push(m), setHiddenThinkingLabel: () => relabels++ } });
	const full = md("l1\nl2\nl3", false).split("\n");
	check("expanded = status + every line", full.length === 4 && full[1].includes("l1") && full[3].includes("l3"), JSON.stringify(full));
	check("expanded status says collapse", full[0].includes("to collapse"));
	check("toggle notifies + relabels", notifications[0] === "Thinking: full text" && relabels === 1);
	await commands.get("thinking-preview")!.handler("", { ui: { notify: (m: string) => notifications.push(m), setHiddenThinkingLabel: () => relabels++ } });
	check("toggle back collapses", md("l1\nl2\nl3", false).split("\n").length === 3 && notifications[1] === "Thinking: preview");
}

// ---- 4. contract scans: what timing keys on exists in installed pi ----
{
	const piDir = join(root, "node_modules", "@earendil-works", "pi-coding-agent");
	const compSrc = readFileSync(join(piDir, "dist/modes/interactive/components/assistant-message.js"), "utf8");
	check("render contract: thinking blocks trimmed", compSrc.includes(".thinking.trim()"));
	check('render contract: thinking runs joined \\n\\n', /join\("\\n\\n"\)/.test(compSrc));
	const piAiTypes = readFileSync(join(root, "node_modules", "@earendil-works", "pi-ai", "dist/types.d.ts"), "utf8");
	check("timing contract: pi-ai emits thinking_start/delta/end", ["thinking_start", "thinking_delta", "thinking_end"].every((t) => piAiTypes.includes(`"${t}"`)));
}

console.log(failures.length === 0 ? "\nall green" : `\n${failures.length} failure(s): ${failures.join("; ")}`);
process.exit(failures.length === 0 ? 0 : 1);

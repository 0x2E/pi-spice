// Smoke harness for @pi-spice/collapse-blocks — run via `npm run smoke`.
//
// Loads the extension with type-only imports stripped, pi-tui's real Box and
// matchesKey injected, and a marker theme, then drives the renderers and the
// thinking transformer through the shapes pi 1.2.0 actually produces:
// framing geometry, real arg shapes (path / edits[]), result-text notices,
// the expansion chain (live flag, command, renderer observer, key tap), the
// thinking timing chain (thinking_start/delta/end events, phase-only
// display), and schema contract checks that fs-scan the installed pi and
// pi-ai packages for the parameter names the summaries read and the
// render/timing forms the thinking key depends on. Any failure exits 1.
//
// The schema scan reads node_modules directly: the pi package's `exports`
// field blocks deep module imports, but not file reads — and the harness
// must not need a running pi.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Box, matchesKey } from "@earendil-works/pi-tui";

globalThis.Box = Box;
globalThis.matchesKey = matchesKey;

const root = new URL("../..", import.meta.url).pathname;
const failures = [];
const check = (name, ok, detail = "") => {
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? ` — ${detail}` : ""}`);
	if (!ok) failures.push(name);
};

// ---- load the extension with type-only imports stripped ----
const tmp = mkdtempSync(join(tmpdir(), "collapse-blocks-smoke-"));
writeFileSync(join(tmp, "package.json"), '{"type":"module"}');
const stripped = readFileSync(join(root, "extensions/collapse-blocks/index.ts"), "utf8")
	.replace(/^import type[\s\S]*?from "[^"]+";\n/gm, "")
	.replace(/^import \{ Box, matchesKey \} from "@earendil-works\/pi-tui";\n/m, "");
writeFileSync(join(tmp, "index.ts"), stripped);
const mod = await import(join(tmp, "index.ts"));

const transformers = [];
const commands = new Map();
const handlers = new Map();
const toolResolvers = [];
mod.default({
	registerToolRenderer: (r) => toolResolvers.push(r),
	registerMarkdownTransformer: (t) => transformers.push(t),
	registerShortcut: () => {},
	registerCommand: (n, o) => commands.set(n, o),
	on: (ev, h) => handlers.set(ev, h),
});
const resolve = (tool, base) => toolResolvers[0](tool, () => base);

// marker theme: colors and bg visible as [..] / {..} in output
const theme = {
	fg: (c, t) => `[${c}]${t}`,
	bg: (c, t) => `{${c}}${t}`,
	bold: (t) => `*${t}*`,
};
const ctx = (o = {}) => ({
	isPartial: false, expanded: false, args: {}, isError: false,
	durationMs: undefined, lastComponent: undefined, outputPad: 1, ...o,
});
const result = (text) => ({ content: [{ type: "text", text }] });
const stubBase = () => ({
	renderCall: () => ({ render: () => ["<builtin>"] }),
	renderResult: () => ({ render: () => ["<builtin>"] }),
});
/** Raw rendered rows (bg markers intact) — for geometry. */
const raw = (comp, w = 100) => comp.render(w).map((l) => l.trim()).filter(Boolean);
/** Content rows (color/bg markers stripped, padding rows dropped) — for assertions. */
const rows = (comp, w = 100) => comp.render(w).map((l) => l.replace(/\{tool\w+Bg\}|\[[a-zA-Z]+\]/g, "").replace(/\*/g, "").trim()).filter(Boolean);

// ---- 1. framing geometry: whole block carries the status bg ----
{
	const bash = resolve("bash", stubBase());
	const fin = raw(bash.renderResult(result("done"), { expanded: false, isPartial: false }, theme, ctx({ args: { command: "npm test" }, durationMs: 3200 })));
	check("finished row = 3 bg rows", fin.length === 3 && fin.every((l) => l.includes("{toolSuccessBg}")), JSON.stringify(fin));
	check("finished call slot = 0 rows", bash.renderCall({ command: "x" }, theme, ctx({ isPartial: false })).render(100).length === 0);
	const run = raw(bash.renderCall({ command: "x" }, theme, ctx({ isPartial: true })));
	check("running call = 1 pending-bg row", run.length === 1 && run[0].includes("{toolPendingBg}"));
	const err = raw(bash.renderResult(result("x\nerror: boom"), { expanded: false, isPartial: false }, theme, ctx({ args: { command: "c" }, isError: true, durationMs: 100 })));
	check("error row = 4 bg rows", err.length === 4 && err.every((l) => l.includes("{toolErrorBg}")));
}

// ---- 2. real arg shapes and result-text handling (pi 1.2.0) ----
{
	const line = (tool, text, args, extra = {}) =>
		rows(resolve(tool, stubBase()).renderResult(result(text), { expanded: false, isPartial: false }, theme, ctx({ args, ...extra })));
	const bash = line("bash", "Compiling v1\nerror: could not compile `pi-tui`\n\nCommand exited with code 101", { command: "cargo build" }, { isError: true });
	check("bash error tail skips exit-code footer", bash.length === 2 && bash[1] === "error: could not compile `pi-tui`" && !bash.some((l) => l.includes("Command exited")), JSON.stringify(bash));
	check("write shows path +N", line("write", "File written", { path: "demo.txt", content: "a\nb\n" })[0].includes("demo.txt +2"));
	check("edit aggregates edits[]", line("edit", "ok", { path: "a.ts", edits: [{ oldText: "a\nb\nc", newText: "x" }, { oldText: "q", newText: "r\ns" }] })[0].includes("+3 −4"));
	check("edit tolerates legacy shape", line("edit", "ok", { file_path: "old.ts", oldText: "a", newText: "b\nc" })[0].includes("old.ts"));
	check("read drops limit notice + blank", line("read", "l1\nl2\nl3\n\n[97 more lines in file. Use offset=4 to continue.]", { path: "big.ts" })[0].includes("3 lines"));
	check("read keeps [ content lines", line("read", "const x = [\n  1,\n]\n[Showing lines 1-3 of 3.]", { path: "a.ts" })[0].includes("3 lines"));
	check("grep drops cap notice", line("grep", "a.ts:1:x\nb.ts:2:y\n\n[100 matches limit reached. Use limit=200 for more]", { pattern: "x" })[0].includes("2 matches"));
	check("grep drops -- separator", line("grep", "a.ts:1:x\nctx\n--\nb.ts:5:x", { pattern: "x" })[0].includes("3 matches"));
	check("ls empty dir = 0 entries", line("ls", "(empty directory)", { path: "e" })[0].includes("0 entries"));
	check("find no-hit = 0 results", line("find", "No files found matching pattern", { pattern: "zz" })[0].includes("0 results"));
}

// ---- 3. expansion chain: live flag, command, renderer observer, key tap ----
let flag = false;
let tap = () => undefined;
{
	const rerenders = [];
	const ui = {
		getToolsExpanded: () => flag,
		setToolsExpanded: (v) => (flag = v),
		setHiddenThinkingLabel: () => rerenders.push(1),
		onTerminalInput: (h) => ((tap = h), () => {}),
	};
	handlers.get("session_start")({}, { ui });
	check("session_start attaches key tap", typeof tap === "function");
	check("session_start refreshes stale flag", (() => { flag = true; rerenders.length = 0; handlers.get("session_start")({}, { ui }); return rerenders.length === 1; })());

	const tf = transformers[0];
	const md = (t) => tf(t, { messageType: "assistant-thinking", isStreaming: false, availableWidth: 80 });
	flag = true;
	check("transformer reads flag live (tool-less)", md("a\nb").split("\n")[0].includes("collapse"));
	flag = false;
	check("transformer collapses again", md("a\nb").split("\n")[0].includes("expand"));

	await commands.get("collapse-blocks").handler("", {});
	check("command flips flag + rerenders", flag === true && rerenders.length >= 1);

	flag = false; rerenders.length = 0;
	const bash = resolve("bash", stubBase());
	bash.renderCall({ command: "x" }, theme, ctx({ expanded: false }));
	const afterCollapse = rerenders.length;
	flag = true;
	bash.renderCall({ command: "x" }, theme, ctx({ expanded: true }));
	check("renderer observer rerenders on flip", rerenders.length === 2, `total=${rerenders.length}`);

	check("matchesKey accepts legacy ctrl+o (\\x0f)", matchesKey("\x0f", "ctrl+o"));
}

// ---- 4. thinking transformer forms ----
{
	flag = false; // section 3 may have left it expanded
	const tf = transformers[0];
	const md = (t, s, w = 80) => tf(t, { messageType: "assistant-thinking", isStreaming: s, availableWidth: w });
	check("non-thinking passes through", tf("**hi**", { messageType: "user", isStreaming: true, availableWidth: 80 }) === "**hi**");
	check("empty passes through", md("  ", false) === "  ");
	const stream = md("one\ntwo\nthree", true).split("\n");
	check("streaming = status + newest line", stream.length === 2 && stream[1].includes("three"));
	check("finished = one line with key hint", md("a\nb").split("\n").length === 1 && md("a\nb").includes("ctrl+o"));
	check("markdown escaped in tail", md("run `x` *y* [z](u)\n", true).split("\n")[1].includes("\\`x\\`"));
	check("narrow width clips", md("long line here", false, 12).length <= 12);
}

// ---- 5. thinking timing: phase-only, live seconds, close, fallback ----
{
	const tf = transformers[0];
	const md = (t, s, w = 80) => tf(t, { messageType: "assistant-thinking", isStreaming: s, availableWidth: w });
	const realNow = Date.now;
	/** Fire a message event with its arrival backdated `agoMs` (the clocks are stamped on arrival). */
	const fire = (ev, deltaType, content, agoMs) => {
		if (agoMs !== undefined) Date.now = () => realNow() - agoMs;
		try {
			handlers.get(ev)({
				type: ev,
				message: { role: "assistant", content },
				...(deltaType ? { assistantMessageEvent: { type: deltaType } } : {}),
			});
		} finally {
			Date.now = realNow;
		}
	};
	const think = (t) => [{ type: "thinking", thinking: t }];

	check("untimed falls back to line count", md("beta\ntwo", false).split("\n")[0].includes("· 2 lines"));

	// Phase opened 8.4s ago and still streaming: whole seconds, counted up live.
	fire("message_update", "thinking_start", think(""), 8400);
	fire("message_update", "thinking_delta", think("alpha thinking"), 8400);
	const live = md("alpha thinking", true).split("\n")[0];
	check("streaming shows live whole seconds", live.includes("· 9s"), live);

	// The phase closed 5.9s ago while the response went on generating text:
	// the shown time is the phase (8.4 − 5.9 = 2.5s), never the response.
	fire("message_update", "thinking_end", think("alpha thinking"), 5900);
	const done = md("alpha thinking", false).split("\n")[0];
	check("closed run shows the phase time only", done.includes("· 2.5s"), done);

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

	// A second phase in the same response (after tool calls): its own window.
	fire("message_update", "thinking_start", [{ type: "tool_call" }, ...think("")], 4800);
	fire("message_update", "thinking_delta", [{ type: "tool_call" }, ...think("run two")], 4800);
	fire("message_update", "thinking_end", [{ type: "tool_call" }, ...think("run two")], 2800);
	check("second phase keeps its own window", md("run two", false).split("\n")[0].includes("· 2.0s"), md("run two", false));

	// An aborted phase (no thinking_end) closes at the response's end.
	fire("message_update", "thinking_start", think(""), 7000);
	fire("message_update", "thinking_delta", think("aborted mid-thought"), 7000);
	fire("message_end", undefined, think("aborted mid-thought"), 1200);
	check("abort closes at response end", md("aborted mid-thought", false).split("\n")[0].includes("· 5.8s"), md("aborted mid-thought", false));

	// Consecutive thinking blocks render as ONE joined markdown, keyed joined,
	// carrying the last block's phase.
	fire("message_update", "thinking_start", think(""), 4000);
	fire("message_update", "thinking_delta", [...think("run three"), ...think("run four")], 4000);
	fire("message_update", "thinking_end", [...think("run three"), ...think("run four")], 1500);
	check("consecutive blocks key as one run", md("run three\n\nrun four", false).includes("· 2.5s"), md("run three\n\nrun four", false));

	// session_start clears the in-memory table; untimed blocks fall back to lines.
	handlers.get("session_start")({}, {
		ui: { getToolsExpanded: () => false, setHiddenThinkingLabel: () => {}, onTerminalInput: () => () => {} },
	});
	check("session_start clears timings", md("alpha thinking", false).includes("· 1 line ·"));
}

// ---- 6. schema contract: what the summaries read exists in installed pi ----
{
	// The exports field exposes no require-condition entry and blocks subpaths;
	// walk node_modules directly — npm hoists workspace deps to the repo root.
	const piDir = join(root, "node_modules", "@earendil-works", "pi-coding-agent");
	const propsOf = (tool) => {
		const src = execFileSync("node", ["-e", `console.log(require('fs').readFileSync(${JSON.stringify(join(piDir, "dist/core/tools", tool + ".js"))}, "utf8"))`], { encoding: "utf8" });
		return new Set([...src.matchAll(/([A-Za-z_][\w]*):\s*Type\./g)].map((m) => m[1]));
	};
	const expected = {
		bash: ["command"], edit: ["path", "edits", "oldText", "newText"], write: ["path", "content"],
		read: ["path", "offset", "limit"], grep: ["pattern", "path"], find: ["pattern", "path"], ls: ["path"],
	};
	for (const [tool, names] of Object.entries(expected)) {
		let props;
		try { props = propsOf(tool); } catch (e) { check(`schema scan ${tool}`, false, e.message); continue; }
		const missing = names.filter((n) => !props.has(n));
		check(`schema contract ${tool}`, missing.length === 0, `missing: ${missing.join(", ")} (have: ${[...props].join(", ")})`);
	}

	// The thinking timing keys on pi's render form (blocks trimmed, runs
	// joined "\n\n") and switches on pi-ai's thinking_start/delta/end event
	// types — all scanned from the installed packages so host drift fails
	// here, not in a user's terminal.
	const compSrc = readFileSync(join(piDir, "dist/modes/interactive/components/assistant-message.js"), "utf8");
	check("render contract: thinking blocks trimmed", compSrc.includes(".thinking.trim()"));
	check('render contract: thinking runs joined \\n\\n', /join\("\\n\\n"\)/.test(compSrc));
	const piAiTypes = readFileSync(join(root, "node_modules", "@earendil-works", "pi-ai", "dist/types.d.ts"), "utf8");
	check("timing contract: pi-ai emits thinking_start/delta/end", ["thinking_start", "thinking_delta", "thinking_end"].every((t) => piAiTypes.includes(`"${t}"`)));
}

console.log(failures.length === 0 ? "\nall green" : `\n${failures.length} failure(s): ${failures.join("; ")}`);
process.exit(failures.length === 0 ? 0 : 1);

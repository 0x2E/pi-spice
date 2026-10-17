/**
 * minimize-blocks — collapse tool rows and thinking blocks into one-line summaries
 *
 * pi draws every block in full — highlighted command or diff, file contents,
 * a ~5-line output preview, a "Took" line, entire reasoning streams — so a
 * working session scrolls itself out of view. This extension collapses the
 * display of the seven built-in tools (bash, edit, write, read, grep, find,
 * ls) and of thinking blocks to one-line summaries, keeping one line of
 * error tail on failure:
 *
 *   $ npm test · ✓ 3.2s
 *   ✎ src/index.ts +12 −3
 *   ✻ thinking · 142 lines · alt+m to expand
 *   $ cargo build · ✗ 18.4s
 *   error: could not compile `pi-tui`
 *
 * While a call runs, the row shows the command plus the live last output
 * line, so long builds still show progress; while thinking streams, the
 * block shows its status line plus the newest line. Expanding reuses pi's
 * own machinery where it exists: `ctrl+o` (app.tools.expand) toggles
 * all tool rows, and expanded rows delegate to the built-in renderers via
 * the resolver's `next()` — exactly what stock pi shows. (pi 1.2.0's help
 * also lists `n` for this, but that binding is dead — `ctrl+o` is the
 * working one. Clicking a row toggles that row, but only in fullscreen
 * mode; regular mode leaves the mouse to the terminal.) Thinking has no
 * built-in expand, so `alt+m` (or
 * `/minimize-blocks`) toggles all thinking blocks between summary and full
 * text, re-rendering history immediately. Collapsed is the default; a
 * restart resets it. Display-only — the session file and the model context
 * are untouched.
 *
 * Tool summaries are per-tool: bash shows command, status and duration;
 * edit and write the path with +/− line stats derived from the call args;
 * read the path with its line count; grep/find/ls the query with hit
 * counts. Counts come from result text lines, excluding pi's "[Showing …]"
 * notices and grep's "No matches found" line. Lines are hard-clipped to
 * the available width by plain character count, so wide characters (CJK,
 * emoji) can render up to twice the budget and wrap an occasional extra
 * row — accepted as the price of simplicity.
 *
 * Mutually exclusive with @pi-spice/thinking-preview, which rewrites
 * thinking display through the same transformer slot: install one or the
 * other, not both (both READMEs say so; running both double-frames
 * thinking blocks).
 *
 * Install: pi install npm:@pi-spice/minimize-blocks
 * Quick test: pi -e ./extensions/minimize-blocks/
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ThemeColor,
	ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

/** One styled text run. `flex` marks the run that shrinks when the line overflows. */
interface Seg {
	text: string;
	color: ThemeColor;
	bold?: boolean;
	flex?: boolean;
}

/** Per-tool summary knowledge: glyph, label source, which meta applies. */
interface ToolShape {
	glyph: string;
	/** Identifying label from the call args: command, path, or query. */
	label: (args: Record<string, unknown>) => string;
	/** bash-style row: status icon + duration suffix. */
	timed?: boolean;
	/** Stats derivable from the call args alone (edit/write +/− lines). */
	argStats?: (args: Record<string, unknown>) => string | undefined;
	/** Count over the result text, with the noun shown after it. */
	count?: (text: string) => number;
	resultNoun?: string;
}

const TOOL_SHAPES: Record<string, ToolShape> = {
	bash: { glyph: "$", timed: true, label: (a) => flatten(str(a.command)) },
	edit: { glyph: "✎", label: (a) => pathOf(a), argStats: editStats },
	write: {
		glyph: "✎",
		label: (a) => pathOf(a),
		argStats: (a) => (str(a.content) ? `+${lineCount(str(a.content))}` : undefined),
	},
	read: { glyph: "▤", label: (a) => str(a.path) || ".", count: contentLineCount, resultNoun: "lines" },
	grep: { glyph: "⌕", label: (a) => str(a.pattern), count: hitLineCount, resultNoun: "matches" },
	find: { glyph: "⌕", label: (a) => str(a.pattern), count: hitLineCount, resultNoun: "results" },
	ls: { glyph: "▤", label: (a) => str(a.path) || ".", count: hitLineCount, resultNoun: "entries" },
};

/**
 * The collapsed rendering of one tool-row slot: styled lines whose `flex` run
 * is clipped to the available width. An empty line set renders zero rows,
 * which is how a finished call empties its call slot (the result slot then
 * carries the whole row as a single line).
 */
class SummaryLines implements Component {
	private theme: Theme | undefined;
	private lines: Seg[][] = [];

	set(theme: Theme, lines: Seg[][]): void {
		this.theme = theme;
		this.lines = lines;
	}

	render(width: number): string[] {
		return this.lines.map((segs) => clipAndStyle(segs, width, this.theme));
	}

	invalidate(): void {
		// Nothing cached — every render rebuilds from the current segments.
	}
}

/** Coerce an unknown arg value to a string; "" when absent or not a string. */
function str(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/** File-path arg, tolerating the legacy `file_path` spelling of stored calls. */
function pathOf(args: Record<string, unknown>): string {
	return str(args.path) || str(args.file_path);
}

/** Collapse a multi-line command onto one line. */
function flatten(command: string): string {
	return command.replace(/\r/g, "").trim().split(/\n+/).join(" ⏎ ");
}

/** Line count of a string, ignoring one trailing newline. */
function lineCount(text: string): number {
	return text === "" ? 0 : text.replace(/\n$/, "").split("\n").length;
}

/** pi's bracketed result notices — meta lines, not content. */
function isNotice(line: string): boolean {
	return line.startsWith("[Showing") || line.startsWith("[Full output");
}

/** Result lines that count as hits: non-empty, not a notice or no-hit line. */
function hitLineCount(text: string): number {
	return (
		text
			.split("\n")
			// grep: "No matches found"; find: "No files found matching pattern".
			.filter((line) => line.trim() !== "" && !isNotice(line) && !/^No (matches|files) found/.test(line)).length
	);
}

/** All content lines of a result, notices excluded (blank lines are content too). */
function contentLineCount(text: string): number {
	return text
		.replace(/\n$/, "")
		.split("\n")
		.filter((line) => !isNotice(line)).length;
}

/** edit's edits[], tolerating the legacy single-edit-at-top-level form. */
function editList(args: Record<string, unknown>): Array<{ oldText: string; newText: string }> | undefined {
	if (
		Array.isArray(args.edits) &&
		args.edits.length > 0 &&
		args.edits.every(
			(edit) =>
				typeof (edit as { oldText?: unknown })?.oldText === "string" &&
				typeof (edit as { newText?: unknown })?.newText === "string",
		)
	) {
		return args.edits as Array<{ oldText: string; newText: string }>;
	}
	if (typeof args.oldText === "string" && typeof args.newText === "string") {
		return [{ oldText: args.oldText, newText: args.newText }];
	}
	return undefined;
}

/** edit stats aggregated over edits[]: +new −old. */
function editStats(args: Record<string, unknown>): string | undefined {
	const edits = editList(args);
	if (!edits) return undefined;
	const plus = edits.reduce((sum, edit) => sum + lineCount(edit.newText), 0);
	const minus = edits.reduce((sum, edit) => sum + lineCount(edit.oldText), 0);
	return `+${plus} −${minus}`;
}

/** bash-style duration, mirroring pi's own formatting. */
function formatDuration(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const total = Math.floor(seconds);
	const minutes = Math.floor(total / 60);
	if (minutes < 60) return `${minutes}m ${total % 60}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${total % 60}s`;
}

/** Last non-empty, non-notice line of a result — the live/error tail. */
function tailLine(text: string): string {
	const lines = text.split("\n").filter((line) => line.trim() !== "" && !isNotice(line));
	return lines.length > 0 ? lines[lines.length - 1] : "";
}

/** Code points of a string (wide characters count once — accepted jitter). */
function chars(text: string): string[] {
	return [...text];
}

/** Compose one styled line, clipping the flex run — or the right edge — to width. */
function clipAndStyle(segs: Seg[], width: number, theme: Theme | undefined): string {
	if (!theme) return "";
	const fixed = segs.reduce((sum, seg) => sum + (seg.flex ? 0 : chars(seg.text).length), 0);
	let out = "";
	let used = 0;
	for (const seg of segs) {
		let text = seg.text;
		// The flex run absorbs the shrink in normal widths; the right-edge cap
		// on fixed runs only bites on widths too narrow for even the meta —
		// better to drop meta than to wrap the summary onto a second line.
		const cap = seg.flex ? Math.max(1, width - fixed) : Math.max(0, width - used);
		if (cap === 0) text = "";
		else if (chars(text).length > cap) text = chars(text).slice(0, cap - 1).join("") + "…";
		out += theme.fg(seg.color, seg.bold ? theme.bold(text) : text);
		used += chars(text).length;
	}
	return out;
}

/** Text content of a result; images are not part of a summary. */
function resultText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((part) => part.type === "text")
		.map((part) => part.text ?? "")
		.join("\n");
}

/** Reuse this slot's SummaryLines across re-renders, as built-in renderers do. */
function slot(context: { lastComponent: Component | undefined }): SummaryLines {
	return context.lastComponent instanceof SummaryLines ? context.lastComponent : new SummaryLines();
}

// ---- Thinking blocks ----

/** Columns consumed by the blockquote bar (`│ `) framing thinking blocks. */
const THINKING_BAR_WIDTH = 2;

/** Shortcut that toggles thinking between summary and full text. */
const THINKING_TOGGLE_KEY = "alt+m";

/** Sticky summary/full-text switch for thinking blocks. Resets on restart. */
let thinkingExpanded = false;

/** Markdown punctuation that could open or span rendering constructs. */
const ESCAPE_CLASS = /[\\`*_{}[\]()<>#+\-!|~&=.:\/\\@]/g;

/** Escape Markdown syntax so summaries render as verbatim plain text. */
function escapeMarkdown(text: string): string {
	return text.replace(ESCAPE_CLASS, (c) => `\\${c}`);
}

/** Hard-clip a line to `maxChars` code points (wide characters count once). */
function clipLine(line: string, maxChars: number): string {
	if (!Number.isFinite(maxChars) || maxChars <= 0) return line;
	return chars(line).slice(0, maxChars).join("");
}

/**
 * The display of one thinking block, as Markdown: a single status line when
 * finished, the status line plus the newest line while streaming, and the
 * full escaped text when toggled open — all inside one `│ `-framed
 * blockquote, the same frame pi gives thinking.
 */
function thinkingMarkdown(markdown: string, isStreaming: boolean, availableWidth: number): string {
	const text = markdown.trim();
	if (!text) return markdown; // redacted/empty blocks render untouched
	const lines = text.split("\n");
	const count = `${lines.length} line${lines.length === 1 ? "" : "s"}`;
	const width = availableWidth - THINKING_BAR_WIDTH;
	if (thinkingExpanded) {
		const status = `✻ thinking · ${count} · ${THINKING_TOGGLE_KEY} to collapse`;
		// Backslash line breaks keep consecutive lines inside one blockquote
		// from gluing into a single wrapped paragraph (CommonMark soft break).
		const body = escapeMarkdown(text)
			.split("\n")
			.map((line) => (line.trim() ? `> ${line}\\` : ">"))
			.join("\n");
		return `> ${clipLine(status, width)}\\\n${body}`;
	}
	if (isStreaming) {
		const tail = lines.filter((line) => line.trim()).at(-1) ?? "";
		const status = `> ${clipLine(`✻ thinking · ${count}`, width)}\\`;
		return tail ? `${status}\n> ${escapeMarkdown(clipLine(tail, width))}` : status;
	}
	return `> ${clipLine(`✻ thinking · ${count} · ${THINKING_TOGGLE_KEY} to expand`, width)}`;
}

/** Flip the display mode and force every message component to re-render. */
async function toggleThinking(ctx: ExtensionContext): Promise<void> {
	thinkingExpanded = !thinkingExpanded;
	try {
		// Re-propagating the hidden-thinking label makes every assistant
		// message component re-render through this extension's transformer, so
		// history picks up the new mode immediately — the visible flip itself is
		// the only feedback. Side effect: a custom hidden-thinking label set
		// elsewhere resets to its default.
		ctx.ui.setHiddenThinkingLabel();
	} catch {
		// Non-interactive modes: the flag still flipped; nothing to redraw.
	}
}

/** Collapsed headline while a call runs: glyph + label, in the call slot. */
function runningLine(shape: ToolShape, args: Record<string, unknown>): Seg[] {
	return [glyphSeg(shape.glyph), { text: shape.label(args), color: "toolTitle", flex: true }];
}

function glyphSeg(glyph: string): Seg {
	return { text: `${glyph} `, color: "toolTitle", bold: true };
}

/** Collapsed result lines: the summary line, plus an error tail on failure. */
function finalLines(
	shape: ToolShape,
	text: string,
	args: Record<string, unknown>,
	isError: boolean,
	durationMs: number | undefined,
): Seg[][] {
	const label = shape.label(args);
	const head: Seg[] = [];
	if (shape.timed) {
		head.push(
			glyphSeg(shape.glyph),
			{ text: label, color: "toolTitle", flex: true },
			{ text: " · ", color: "dim" },
			{ text: isError ? "✗" : "✓", color: isError ? "error" : "success" },
		);
		if (durationMs !== undefined) head.push({ text: ` ${formatDuration(durationMs)}`, color: "dim" });
	} else if (isError) {
		head.push({ text: "✗ ", color: "error", bold: true }, { text: label, color: "toolTitle", flex: true });
	} else {
		head.push(glyphSeg(shape.glyph), { text: label, color: "toolTitle", flex: true });
		const stats = shape.argStats?.(args);
		if (stats) head.push({ text: ` ${stats}`, color: "dim" });
		if (shape.resultNoun && shape.count) {
			head.push({ text: ` · ${shape.count(text)} ${shape.resultNoun}`, color: "dim" });
		}
	}
	if (!isError) return [head];
	const tail = tailLine(text);
	return tail ? [head, [{ text: tail, color: "error", flex: true }]] : [head];
}

export default function minimizeBlocks(pi: ExtensionAPI) {
	// ---- Tool rows: render one-line summaries, delegate to pi when expanded ----
	pi.registerToolRenderer((toolName, next) => {
		const shape = TOOL_SHAPES[toolName];
		if (!shape) return next(); // not one of ours: pi's rendering stays in place
		const base = next(); // built-in renderers, delegated to when expanded

		const renderers: ToolRenderers = {
			// edit draws its own frame; keep whatever shell the built-in tool uses.
			renderShell: base?.renderShell,
			renderCall(args, theme, context) {
				// Args can be absent on invalid calls (pi's own renderers guard `args?.…`).
				const call = (args as Record<string, unknown> | undefined) ?? {};
				if (context.expanded && base?.renderCall) {
					// Hand the built-in renderer a fresh component chain: it expects
					// to grow its own lastComponent type, not a SummaryLines.
					return base.renderCall(args, theme, { ...context, lastComponent: undefined });
				}
				const summary = slot(context);
				// A finished row carries everything in its result slot, so the call
				// slot empties and the whole row stays a single line.
				summary.set(theme, context.isPartial ? [runningLine(shape, call)] : []);
				return summary;
			},
			renderResult(result, options, theme, context) {
				if (options.expanded && base?.renderResult) {
					return base.renderResult(result, options, theme, { ...context, lastComponent: undefined });
				}
				const summary = slot(context);
				const text = resultText(result);
				if (options.isPartial) {
					const tail = tailLine(text);
					const lines: Seg[][] = tail ? [[{ text: tail, color: "muted", flex: true }]] : [];
					summary.set(theme, lines);
					return summary;
				}
				const call = (context.args as Record<string, unknown> | undefined) ?? {};
				summary.set(theme, finalLines(shape, text, call, context.isError, context.durationMs));
				return summary;
			},
		};
		return renderers;
	});

	// ---- Thinking blocks: rewrite the display through a Markdown transformer ----
	pi.registerMarkdownTransformer((markdown, { messageType, isStreaming, availableWidth }) =>
		messageType === "assistant-thinking" ? thinkingMarkdown(markdown, isStreaming, availableWidth) : markdown,
	);

	pi.registerShortcut(THINKING_TOGGLE_KEY, {
		description: "Toggle thinking summary / full text",
		handler: (ctx) => toggleThinking(ctx),
	});

	// Command fallback for when the shortcut is rebound.
	pi.registerCommand("minimize-blocks", {
		description: "Toggle thinking summary / full text",
		handler: (_args, ctx) => toggleThinking(ctx),
	});
}

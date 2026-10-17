/**
 * thinking-preview — collapse streaming thinking blocks into a compact live preview
 *
 * pi streams reasoning tokens in full, which can flood the transcript on long
 * thinking turns. This extension rewrites the *display* of every thinking block
 * (via a Markdown transformer — display-only; the session and model context are
 * untouched) into a three-line preview:
 *
 *   ✻ thinking · 8.4s · alt+t to expand
 *   <second-to-last line of thinking>
 *   <last line of thinking>
 *
 * The status line's meta is the thinking phase's own time — measured from
 * the message stream's thinking_start to thinking_end, or to the first
 * text/tool-call event (openai-completions-style providers emit
 * thinking_end only after the whole stream), so the text the response goes
 * on to generate never counts — counting up in whole seconds while
 * streaming and freezing to the exact phase length when it closes;
 * each of a response's thinking runs keeps its own phase. Timings live in
 * memory only (the session file stays untouched): blocks that streamed
 * before this session of the extension, or after a restart, are untimed and
 * fall back to a line count.
 *
 * The preview refreshes on every streaming token, so the block doubles as a
 * progress indicator. Preview content is plain text: Markdown syntax characters
 * are escaped and rendered verbatim, and each preview line is hard-clipped to
 * the available terminal width — by plain character count, with no per-charset
 * width tables. Wide characters (CJK, emoji) can therefore render up to twice
 * the budget and wrap an occasional extra row; that slight height jitter is
 * accepted as the price of simplicity. All three lines render as a blockquote,
 * giving the block a `│ ` left bar and its own quote color — visually distinct
 * from plain thinking text.
 *
 * `alt+t` (or `/thinking-preview`) toggles all thinking blocks between preview
 * and full text; toggling re-renders history too. Restart resets to the
 * collapsed default. pi's built-in ctrl+t ("hide thinking blocks") takes
 * precedence: when thinking is hidden there is nothing to preview, and the
 * toggle has no visible effect until thinking is visible again.
 *
 * Install: pi install npm:@pi-spice/thinking-preview
 * Quick test: pi -e ./extensions/thinking-preview/
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Tail lines shown under the status line while collapsed. */
const PREVIEW_LINES = 2;

/** Hint shown in the status line; must match the registered shortcut. */
const TOGGLE_KEY = "alt+t";

/** Columns consumed by the blockquote left bar (`│ `) framing each line. */
const QUOTE_BAR_WIDTH = 2;

/** Sticky preview/full-text switch. Resets to preview on restart. */
let expanded = false;

/**
 * Markdown punctuation that could open or span rendering constructs
 * (emphasis, code, links, headings, lists, tables, …). Backslash-escaped so
 * previews render as plain text in CommonMark renderers (pi uses marked).
 */
const ESCAPE_CLASS = /[\\`*_{}[\]()<>#+\-!|~&=.:\/\\@]/g;

/** Escape Markdown syntax so text renders verbatim. Newlines pass through. */
export function escapeMarkdown(text: string): string {
	return text.replace(ESCAPE_CLASS, (c) => `\\${c}`);
}

/**
 * Hard-clip a line to at most `maxChars` characters — plain character count,
 * no per-charset width tables. A line of wide characters (CJK, emoji) can thus
 * render up to 2× the column budget and wrap an extra row; accepted jitter.
 */
export function clipLine(line: string, maxChars: number): string {
	if (!Number.isFinite(maxChars) || maxChars <= 0) return line;
	return [...line].slice(0, maxChars).join("");
}

/** Flip the display mode and force every message component to re-render. */
async function toggle(ctx: ExtensionContext): Promise<void> {
	expanded = !expanded;
	ctx.ui.notify(expanded ? "Thinking: full text" : "Thinking: preview", "info");
	try {
		// Re-propagating the hidden-thinking label makes every assistant
		// message component re-render through this extension's transformer, so
		// history picks up the new mode immediately instead of waiting for the
		// next streaming token or a terminal resize. Side effect: a custom
		// hidden-thinking label set elsewhere resets to its default.
		ctx.ui.setHiddenThinkingLabel();
	} catch {
		// Non-interactive modes: the flag still flipped; nothing to redraw.
	}
}

// ---- Thinking timing ----

/** Timing of one thinking run: its streaming phase, as the message events saw it. */
interface ThinkingTiming {
	/** Unix ms when the run's thinking_start (or first delta) arrived. */
	start: number;
	/** Unix ms when its thinking_end (or the response's end) arrived; undefined while streaming. */
	end: number | undefined;
}

/**
 * Run timings keyed by the first 64 code points of the run's display text —
 * the same trim + "\n\n" join pi renders with, so the transformer's markdown
 * keys back into a timing the message events recorded. While a run streams
 * its text grows, re-keying it until it passes 64 characters; the short-lived
 * keys become orphaned entries, harmless and capped away with the rest.
 */
const thinkingTimings = new Map<string, ThinkingTiming>();
const TIMING_KEY_CHARS = 64;
const TIMING_MAX_ENTRIES = 512;

/** The thinking run currently streaming: opened at thinking_start, keyed once its text exists. */
let liveRun: { start: number; key: string | undefined } | undefined;

/** A content block as far as run identity cares: thinking blocks carry text. */
interface MaybeThinking {
	type: string;
	thinking?: string;
}

/**
 * The display text of each run of consecutive thinking blocks, mirroring
 * pi's renderer: blocks trimmed, empty ones skipped, joined with "\n\n".
 */
function thinkingRuns(content: readonly MaybeThinking[]): string[] {
	const runs: string[] = [];
	let current: string[] = [];
	for (const block of content) {
		if (block.type !== "thinking") {
			if (current.length > 0) runs.push(current.join("\n\n"));
			current = [];
			continue;
		}
		const text = (block.thinking ?? "").trim();
		if (text) current.push(text);
	}
	if (current.length > 0) runs.push(current.join("\n\n"));
	return runs;
}

/** Key a thinking run by its display text. */
function timingKey(text: string): string {
	return [...text].slice(0, TIMING_KEY_CHARS).join("");
}

/** Upsert a timing, refreshing insertion order; evict oldest past the cap. */
function upsertTiming(key: string, timing: ThinkingTiming): void {
	thinkingTimings.delete(key);
	thinkingTimings.set(key, timing);
	while (thinkingTimings.size > TIMING_MAX_ENTRIES) {
		const oldest = thinkingTimings.keys().next().value; // undefined only when empty
		if (oldest === undefined) break;
		thinkingTimings.delete(oldest);
	}
}

/**
 * Track the streaming thinking phase from the message events: opened at
 * thinking_start, re-keyed as the text grows on every delta, closed at
 * thinking_end — or at the first text/tool-call event, because
 * openai-completions-style providers emit thinking_end only after the whole
 * stream and waiting for it would run the counter through the text
 * generation. The response's end closes a run that never saw either
 * (aborted responses, or thinking-only responses). Fallbacks keep the clock
 * honest when an event is missed: a delta without a start opens late.
 * Several runs in one response each keep their own phase; a run of
 * consecutive blocks renders joined and shows the last block's phase.
 */
function onThinkingEvent(eventType: string | undefined, content: readonly MaybeThinking[]): void {
	const now = Date.now();
	if (eventType === "thinking_start") {
		liveRun = { start: now, key: undefined };
		return;
	}
	if (eventType === "thinking_delta") {
		const key = timingKey(thinkingRuns(content).at(-1) ?? "");
		if (!key) return; // redacted/empty: nothing displayable to time yet
		liveRun ??= { start: now, key: undefined }; // missed the start: open late
		liveRun.key = key;
		upsertTiming(key, { start: liveRun.start, end: undefined });
		return;
	}
	if (eventType === "thinking_end") {
		const key = timingKey(thinkingRuns(content).at(-1) ?? "");
		if (liveRun && key) upsertTiming(key, { start: liveRun.start, end: now });
		liveRun = undefined;
		return;
	}
	// First text/tool-call event: the phase is over. Providers that emit
	// thinking_end at its native boundary have already closed the run above;
	// openai-completions-style providers only emit it after the whole stream.
	if (liveRun?.key) {
		upsertTiming(liveRun.key, { start: liveRun.start, end: now });
		liveRun = undefined;
	}
}

/** Close a still-open phase at the response's end (abort path); forget the live run. */
function onAssistantMessageEnd(): void {
	if (liveRun?.key) upsertTiming(liveRun.key, { start: liveRun.start, end: Date.now() });
	liveRun = undefined;
}

/** Finished thinking time, mirroring pi's own duration formatting. */
function formatDuration(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const total = Math.floor(seconds);
	const minutes = Math.floor(total / 60);
	if (minutes < 60) return `${minutes}m ${total % 60}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${total % 60}s`;
}

/** Live thinking time: whole seconds — a calmer counter than formatDuration's decimals. */
function streamingDuration(ms: number): string {
	const total = Math.max(1, Math.ceil(ms / 1000));
	const minutes = Math.floor(total / 60);
	if (minutes < 1) return `${total}s`;
	if (minutes < 60) return `${minutes}m ${total % 60}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${total % 60}s`;
}

/**
 * The meta segment of the status line: the phase's time when known — exact
 * once closed, whole seconds counting up while streaming — and the line
 * count only when untimed (blocks that streamed before this session of the
 * extension, restarted or restored sessions).
 */
function thinkingMeta(markdown: string, lineCount: number, isStreaming: boolean): string {
	const timing = thinkingTimings.get(timingKey(markdown));
	if (timing) {
		if (timing.end !== undefined) return formatDuration(Math.max(0, timing.end - timing.start));
		if (isStreaming) return streamingDuration(Math.max(0, Date.now() - timing.start));
	}
	return `${lineCount} line${lineCount === 1 ? "" : "s"}`;
}

export default function (pi: ExtensionAPI) {
	// The thinking phase is timed from the message events (thinking_start /
	// thinking_delta / thinking_end); timings live in memory only, so a new
	// session starts with a clean table and history falls back to line counts.
	pi.on("message_update", (event) => {
		if (event.message.role === "assistant") onThinkingEvent(event.assistantMessageEvent?.type, event.message.content);
	});
	pi.on("message_end", (event) => {
		if (event.message.role === "assistant") onAssistantMessageEnd();
	});
	pi.on("session_start", () => {
		thinkingTimings.clear();
		liveRun = undefined;
	});

	pi.registerMarkdownTransformer((markdown, { messageType, isStreaming, availableWidth }) => {
		if (messageType !== "assistant-thinking") return markdown;
		const text = markdown.trim();
		if (!text) return markdown;

		// Simple by design: fall back to counting lines when the phase time is
		// unknown; otherwise the status line carries the time (see
		// thinkingMeta). The last two non-empty lines preview the stream, each
		// clipped to the terminal width by plain character count — no
		// per-charset width math, so wide characters may wrap an extra row.
		const lines = text.split("\n");
		const action = expanded ? "to collapse" : "to expand";
		const meta = thinkingMeta(markdown, lines.length, isStreaming);
		const status = `✻ thinking · ${meta} · ${TOGGLE_KEY} ${action}`;
		const width = availableWidth - QUOTE_BAR_WIDTH;
		const statusLine = clipLine(status, width);

		// Backslash line breaks keep consecutive lines inside one blockquote
		// from gluing into a single wrapped paragraph (CommonMark soft break).
		if (expanded) {
			// Full plain text inside the same `│ `-framed block, natural wrap;
			// source line structure preserved via hard breaks, blank lines as `>`.
			const body = escapeMarkdown(text)
				.split("\n")
				.map((line) => (line.trim() ? `> ${line}\\` : ">"))
				.join("\n");
			return `> ${statusLine}\\\n${body}`;
		}

		const tail = lines
			.filter((line) => line.trim())
			.slice(-PREVIEW_LINES)
			.map((line) => escapeMarkdown(clipLine(line, width)));
		return [`> ${statusLine}\\`, ...tail.map((line, i) => `> ${line}${i < tail.length - 1 ? "\\" : ""}`)].join("\n");
	});

	pi.registerShortcut(TOGGLE_KEY, {
		description: "Toggle thinking preview / full text",
		handler: (ctx) => toggle(ctx),
	});

	// Command fallback for when the shortcut is rebound.
	pi.registerCommand("thinking-preview", {
		description: "Toggle thinking preview / full text",
		handler: (_args, ctx) => toggle(ctx),
	});
}

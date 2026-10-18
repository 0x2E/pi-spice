/**
 * thinking-preview — collapse streaming thinking blocks into a compact live preview
 *
 * pi streams reasoning tokens in full, which floods the transcript on long
 * thinking turns. This extension rewrites the display of every thinking block
 * through a Markdown transformer: a status line plus up to two tail lines,
 * inside a blockquote that keeps pi's `│ ` bar and quote color.
 *
 *   ✻ thinking · 8.4s · alt+t to expand
 *   <second-to-last line>
 *   <last line>
 *
 * Content is plain text: Markdown syntax is escaped and lines are clipped by
 * character count, so wide characters can wrap an extra row. Thinking time is
 * measured per phase (see "Thinking timing" below).
 *
 * `alt+t` (or /thinking-preview) toggles all thinking blocks between preview
 * and full text. The flag is global, not saved, and resets with the process
 * or `/reload`. pi's ctrl+t (hide thinking) takes precedence; hidden blocks
 * render as a label and this extension has no visible effect until thinking
 * is shown.
 *
 * Display-only: the session file and the model context keep the full text.
 * Mutually exclusive with @pi-spice/collapse-blocks: both transform
 * assistant-thinking Markdown and pi chains the transformers.
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

/** Sticky preview/full-text switch. Not saved: a new process or `/reload` starts in preview. */
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
 * Clip a line to at most `maxChars` code points. Width is counted per code
 * point, not per column, so wide characters (CJK, emoji) can wrap an extra
 * row.
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
 * Run timings keyed by a hash of the run's display text. The open run drops
 * its previous key as the text grows, so the map holds one record per closed
 * run plus at most one open record; only identical text collides.
 */
const thinkingTimings = new Map<string, ThinkingTiming>();
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

/** Stable per-run key: FNV-1a over the run's display text. */
function timingKey(text: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
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
 * Track the streaming phase from message events: open at thinking_start,
 * re-key on each delta, close at thinking_end or the first non-thinking
 * event (openai-completions providers emit thinking_end only at stream end).
 * message_end closes a run that saw neither; a delta without a start opens
 * late. Consecutive blocks render as one run and show the last block's phase.
 */
function onThinkingEvent(eventType: string | undefined, content: readonly MaybeThinking[]): void {
	const now = Date.now();
	if (eventType === "thinking_start") {
		closeLiveRun(now); // defensive: a start while a run is open closes that run
		liveRun = { start: now, key: undefined };
		return;
	}
	if (eventType === "thinking_delta") {
		const text = thinkingRuns(content).at(-1) ?? "";
		const key = text ? timingKey(text) : "";
		if (!key) return; // redacted/empty: nothing displayable to time yet
		// A delta for a run already timed — a stray reasoning chunk after the
		// phase closed — must neither reopen nor overwrite that time.
		if (thinkingTimings.get(key)?.end !== undefined) return;
		liveRun ??= { start: now, key: undefined }; // missed the start: open late
		// The key follows the growing text; drop the open run's previous key so
		// only one open record ever exists.
		if (liveRun.key !== undefined && liveRun.key !== key) thinkingTimings.delete(liveRun.key);
		liveRun.key = key;
		upsertTiming(key, { start: liveRun.start, end: undefined });
		return;
	}
	if (eventType === "thinking_end") {
		// thinking_end carries the authoritative text, so re-key from it: the open
		// record may predate the run's final characters.
		const text = thinkingRuns(content).at(-1) ?? "";
		const key = text ? timingKey(text) : undefined;
		if (liveRun && key) {
			if (liveRun.key !== undefined && liveRun.key !== key) thinkingTimings.delete(liveRun.key);
			liveRun.key = key;
		}
		closeLiveRun(now);
		return;
	}
	// First text/tool-call event: the phase is over. Providers that emit
	// thinking_end at its native boundary have already closed the run above;
	// openai-completions-style providers only emit it after the whole stream.
	closeLiveRun(now);
}

/**
 * Close the open run at `now` and forget it. A record that is already closed
 * keeps the time it was closed with.
 */
function closeLiveRun(now: number): void {
	if (liveRun?.key) {
		const existing = thinkingTimings.get(liveRun.key);
		if (existing === undefined || existing.end === undefined) {
			upsertTiming(liveRun.key, { start: liveRun.start, end: now });
		}
	}
	liveRun = undefined;
}

/** Close a still-open phase at the response's end (abort path); forget the live run. */
function onAssistantMessageEnd(): void {
	closeLiveRun(Date.now());
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

/**
 * Live thinking time: whole seconds, floored so the number never steps
 * backward when the phase closes and its exact time replaces this.
 */
function streamingDuration(ms: number): string {
	if (ms < 1000) return "<1s";
	const total = Math.floor(ms / 1000);
	const minutes = Math.floor(total / 60);
	if (minutes < 1) return `${total}s`;
	if (minutes < 60) return `${minutes}m ${total % 60}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${total % 60}s`;
}

/**
 * Status meta: phase time when recorded — exact when closed, whole seconds
 * while streaming — else the line count.
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

		// Simple by design: the status line carries the phase time when known,
		// otherwise the line count. The last two non-empty lines preview the
		// stream; each is clipped by character count, so wide characters may
		// wrap an extra row.
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

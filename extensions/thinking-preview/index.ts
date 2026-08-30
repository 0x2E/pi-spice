/**
 * thinking-preview — collapse streaming thinking blocks into a compact live preview
 *
 * pi streams reasoning tokens in full, which can flood the transcript on long
 * thinking turns. This extension rewrites the *display* of every thinking block
 * (via a Markdown transformer — display-only; the session and model context are
 * untouched) into a three-line preview:
 *
 *   ✻ thinking · 142 lines · alt+t to expand
 *   <second-to-last line of thinking>
 *   <last line of thinking>
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

export default function (pi: ExtensionAPI) {
	pi.registerMarkdownTransformer((markdown, { messageType, availableWidth }) => {
		if (messageType !== "assistant-thinking") return markdown;
		const text = markdown.trim();
		if (!text) return markdown;

		// Simple by design: count lines as-is, show the last two non-empty lines,
		// each clipped to the terminal width by plain character count — no
		// per-charset width math, so wide characters may wrap an extra row.
		const lines = text.split("\n");
		const action = expanded ? "to collapse" : "to expand";
		const status = `✻ thinking · ${lines.length} line${lines.length === 1 ? "" : "s"} · ${TOGGLE_KEY} ${action}`;
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

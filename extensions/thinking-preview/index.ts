/**
 * thinking-preview — collapse streaming thinking blocks into a compact live preview
 *
 * pi streams reasoning tokens in full, which can flood the transcript on long
 * thinking turns. This extension rewrites the *display* of every thinking block
 * (via a Markdown transformer — display-only; the session and model context are
 * untouched) into a fixed-height preview:
 *
 *   ✻ thinking · 142 lines · alt+t to expand
 *   <second-to-last line of thinking>
 *   <last line of thinking>
 *
 * The preview refreshes on every streaming token, so the block doubles as a
 * progress indicator. Preview content is plain text: Markdown syntax
 * characters are escaped and rendered verbatim, and each line is hard-sliced
 * to the available width (width-aware for CJK) so the block never grows.
 *
 * `alt+t` (or `/thinking-preview`) toggles all thinking blocks between preview
 * and full text; toggling re-renders history too. Restart resets to the
 * collapsed default. pi's built-in ctrl+t ("hide thinking blocks") takes
 * precedence: when thinking is hidden there is nothing to preview, and the
 * toggle has no visible effect until thinking is visible again.
 *
 * Install: pi install npm:@pi-spice/thinking-preview
 * Quick test: pi -e ./extensions/thinking-preview
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Tail lines shown under the status line while collapsed. */
const PREVIEW_LINES = 2;

/** Hint shown in the status line; must match the registered shortcut. */
const TOGGLE_KEY = "alt+t";

/** Sticky preview/full-text switch. Resets to preview on restart. */
let expanded = false;

/**
 * Markdown punctuation that could open or span rendering constructs
 * (emphasis, code, links, headings, lists, tables, …). Backslash-escaped so
 * previews render as plain text in CommonMark renderers (pi uses marked).
 */
const ESCAPE_CLASS = /[\\`*_{}[\]()<>#+\-!|~&=.]/g;

/** Escape Markdown syntax so text renders verbatim. Newlines pass through. */
export function escapeMarkdown(text: string): string {
	return text.replace(ESCAPE_CLASS, (c) => `\\${c}`);
}

/** Terminal column width of a code point: 2 for CJK/fullwidth ranges, else 1. */
function charWidth(cp: number): number {
	return (
		(cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
		(cp >= 0x2e80 && cp <= 0xa4cf) || // CJK radicals … Yi
		(cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
		(cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
		(cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compatibility forms
		(cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
		(cp >= 0xffe0 && cp <= 0xffe6) ||
		(cp >= 0x1f000 && cp <= 0x1faff) || // emoji / pictographs (rocket 🚀, cards, …)
		(cp >= 0x20000 && cp <= 0x3fffd) // CJK extension B+
			? 2
			: 1
	);
}

/** Hard-slice a line to `width` terminal columns, walking code points. */
export function sliceToWidth(line: string, width: number): string {
	if (width <= 0) return line;
	let used = 0;
	let out = "";
	for (const ch of line) {
		const w = charWidth(ch.codePointAt(0)!);
		if (used + w > width) break;
		out += ch;
		used += w;
	}
	return out;
}

/** Last `count` non-empty logical lines (oldest → newest), via backward scan. */
export function tailLines(text: string, count: number): string[] {
	const out: string[] = [];
	let end = text.length;
	while (out.length < count && end > 0) {
		const start = text.lastIndexOf("\n", end - 1) + 1;
		const line = text.slice(start, end).trim();
		if (line) out.push(line);
		if (start === 0) break;
		end = start - 1;
	}
	return out.reverse();
}

/** Number of non-empty logical lines, for the status line. */
function countNonEmptyLines(text: string): number {
	let n = 0;
	for (const line of text.split("\n")) if (line.trim()) n++;
	return n;
}

/** Flip the display mode and force every message component to re-render. */
function toggle(ctx: ExtensionContext): void {
	expanded = !expanded;
	try {
		// Re-propagating the hidden-thinking label makes every assistant
		// message component re-render through this extension's transformer, so
		// history picks up the new mode immediately instead of waiting for the
		// next streaming token or a terminal resize. Side effect: a custom
		// hidden-thinking label set elsewhere resets to its default.
		ctx.ui.setHiddenThinkingLabel();
		ctx.ui.notify(expanded ? "Thinking: full text" : "Thinking: preview", "info");
	} catch {
		// Non-interactive modes: the flag still flipped; nothing to redraw.
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerMarkdownTransformer((markdown, { messageType, availableWidth }) => {
		if (messageType !== "assistant-thinking") return markdown;
		const text = markdown.trim();
		if (!text) return markdown;

		const lineCount = countNonEmptyLines(text);
		const action = expanded ? "to collapse" : "to expand";
		const status = `✻ thinking · ${lineCount} line${lineCount === 1 ? "" : "s"} · ${TOGGLE_KEY} ${action}`;

		if (expanded) return `${status}\n\n${escapeMarkdown(text)}`;

		const width = Math.max(availableWidth, 20);
		const tail = tailLines(text, PREVIEW_LINES).map((line) => escapeMarkdown(sliceToWidth(line, width)));
		return [status, ...tail].join("\n\n");
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

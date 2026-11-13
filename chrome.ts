/**
 * Copilot-style message chrome.
 *
 * pi renders user messages in a background box and assistant messages without
 * a prefix. Copilot prints `❯ prompt` and `● reply` flush left instead. pi
 * exports the message components, so the chrome is a `render` wrapper on their
 * prototypes. Everything is duck-typed and guarded: if pi's internals change,
 * the wrapper degrades to the built-in rendering instead of throwing.
 */

import {
	AssistantMessageComponent,
	type Theme,
	ToolExecutionComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";

import { GLYPH, paint } from "./grammar.ts";
import type { CopilotStyleSettings } from "./settings.ts";

/**
 * Originals are kept on the prototype itself, so `/reload` reinstalls the
 * wrapper instead of stacking another one — and a changed wrapper actually
 * takes effect after a reload.
 */
const ORIGINALS = Symbol.for("pi-copilot-style:originals");

let themeGetter: () => Theme | undefined = () => undefined;

/** Reasoning starts as `Thinking` and settles into `Thought for Ns`, like Copilot. */
let thinkingLabels = { done: "Thought", active: "Thinking…" };

/**
 * Elapsed time per assistant message, keyed by the message object so a later
 * turn can never rewrite a row that already settled.
 *
 * pi only renders the collapsed reasoning label once, when the assistant
 * message settles — it never paints a `Thinking` frame while streaming. So the
 * label carries the elapsed time of that one response instead of a
 * Thinking → Thought transition.
 */
const messageStartedAt = new WeakMap<object, number>();
const messageElapsedMs = new WeakMap<object, number>();

export function noteAssistantMessageStart(message?: object): void {
	if (!message) return;
	messageStartedAt.set(message, Date.now());
	messageElapsedMs.delete(message);
}

export function noteAssistantMessageEnd(message?: object): void {
	if (!message) return;
	const startedAt = messageStartedAt.get(message);
	messageStartedAt.delete(message);
	if (startedAt !== undefined) messageElapsedMs.set(message, Date.now() - startedAt);
}

/**
 * Duration of the response a component is showing.
 *
 * pi stamps the final message of every response with `durationMs` (monotonic,
 * `AssistantMessageEventStream`), so the number belongs to the message itself:
 * it survives re-renders, scroll-back and a reloaded session. The local timing
 * is only a fallback for hosts that do not stamp it; messages that predate
 * either (legacy sessions) fall back to a bare `Thought`.
 */
function responseElapsedMs(component: any): number | undefined {
	const message = component?.lastMessage;
	const stamped = message?.durationMs;
	if (typeof stamped === "number" && Number.isFinite(stamped) && stamped >= 0) return stamped;
	if (message && messageElapsedMs.has(message)) return messageElapsedMs.get(message);
	return undefined;
}

function reasoningLabel(component: any): string {
	// If a host ever paints the label mid-stream, keep Copilot's present tense.
	if (component?.isStreaming === true) return thinkingLabels.active;
	const elapsed = responseElapsedMs(component);
	if (typeof elapsed !== "number") return thinkingLabels.done;
	const seconds = Math.round(elapsed / 1000);
	return seconds >= 1 ? `${thinkingLabels.done} for ${seconds}s` : thinkingLabels.done;
}

function resolveTheme(): Theme | undefined {
	try {
		return themeGetter();
	} catch {
		return undefined;
	}
}

type Wrapper = (original: (...args: any[]) => any) => (...args: any[]) => any;

/** Install (or reinstall after a reload) a method wrapper over its original. */
function install(proto: any, method: string, wrap: Wrapper): boolean {
	if (!proto || typeof proto[method] !== "function") return false;
	const originals: Record<string, (...args: any[]) => any> = (proto[ORIGINALS] ??= {});
	originals[method] ??= proto[method];
	proto[method] = wrap(originals[method] as (...args: any[]) => any);
	return true;
}

const ANSI_RE = /\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07]*(?:\x07|\x1b\\))/g;

function visibleText(line: string): string {
	return String(line ?? "").replace(ANSI_RE, "");
}

/** `❯ first line`, continuation lines indented by two columns. */
function prefixRow(
	lines: unknown,
	glyph: string,
	tone: "accent" | "muted",
	skip: ReadonlySet<number> = new Set<number>(),
): unknown {
	if (!Array.isArray(lines) || lines.length === 0) return lines;
	const index = lines.findIndex((line, i) => !skip.has(i) && visibleText(String(line)).trim() !== "");
	if (index < 0) return lines;
	const prefix = `${paint(resolveTheme(), tone, glyph)} `;
	return lines.map((line: string, i: number) => {
		if (i === index) return `${prefix}${line}`;
		if (skip.has(i)) return line;
		if (visibleText(String(line)).trim() === "") return line;
		return `  ${line}`;
	});
}

/** Drop the blank line pi puts above every self-rendered tool row. */
function patchToolRowSpacing(): void {
	const proto: any = ToolExecutionComponent.prototype;
	install(proto, "render", (original) =>
		function copilotToolRender(this: any, width: number) {
			const lines = original.call(this, width);
			if (!Array.isArray(lines) || lines.length === 0) return lines;
			const isSelf = this?.toolDefinition?.renderShell === "self";
			if (isSelf && lines[0] === "") return lines.slice(1);
			return lines;
		},
	);

	// Keep click-to-expand aligned after removing that leading row.
	install(proto, "handleMouse", (original) =>
		function copilotToolHandleMouse(this: any, event: any) {
			const isSelf = this?.toolDefinition?.renderShell === "self";
			if (isSelf && event && typeof event.y === "number") {
				return original.call(this, { ...event, y: event.y + 1 });
			}
			return original.call(this, event);
		},
	);
}

/** `❯ prompt` with no background box. */
function patchUserMessage(): void {
	const proto: any = UserMessageComponent.prototype;
	install(proto, "render", (originalRender) =>
		function copilotUserRender(this: any, width: number) {
		try {
			for (const child of this?.children ?? []) {
				const markdown = child as any;
				if (!markdown || typeof markdown.render !== "function") continue;
				if (markdown.defaultTextStyle?.bgColor) {
					markdown.defaultTextStyle.bgColor = undefined;
					markdown.invalidate?.();
				}
				// pi pads user markdown one column; the ❯ prefix supplies the indent.
				if (typeof markdown.paddingX === "number" && markdown.paddingX !== 0) {
					markdown.paddingX = 0;
					markdown.invalidate?.();
				}
			}
		} catch {
			// Fall through to pi's rendering.
		}
			const contentWidth = Math.max(1, width - 2);
			const lines = originalRender.call(this, contentWidth);
			return prefixRow(lines, GLYPH.user, "accent");
		},
	);
}

/** `● reply` flush left, no leading pad; collapsed reasoning reads `❯ Thought`. */
function patchAssistantMessage(): void {
	const proto: any = AssistantMessageComponent.prototype;
	install(proto, "render", (originalRender) =>
		function copilotAssistantRender(this: any, width: number) {
		try {
			if (this?.outputPad !== 0 && typeof this.setOutputPad === "function") {
				this.setOutputPad(0);
			}
		} catch {
			// Keep pi's padding if the component shape changed.
		}
			let lines = originalRender.call(this, Math.max(1, width - 2));
			if (!Array.isArray(lines) || lines.length === 0) return lines;

			// Collapsed reasoning reads as `❯ Thinking` while it streams, then
			// `❯ Thought` (with elapsed time) once the message settles.
			const rendered = String(this?.hiddenThinkingLabel ?? "").trim();
			const thinking = new Set<number>();
			if (rendered) {
				const theme = resolveTheme();
				const label = reasoningLabel(this);
				const styled = theme?.italic?.(paint(theme, "dim", label)) ?? paint(theme, "dim", label);
				const replacement = `${paint(theme, "dim", GLYPH.thinking)} ${styled}`;
				lines = lines.map((line: string, index: number) => {
					if (visibleText(String(line)).trim() !== rendered) return line;
					thinking.add(index);
					return replacement;
				});
			}
			return prefixRow(lines, GLYPH.assistant, "accent", thinking);
		},
	);
}

export function applyChromePatches(getTheme: () => Theme | undefined, settings: CopilotStyleSettings): void {
	themeGetter = getTheme;
	if (settings.thinkingLabel) {
		thinkingLabels = {
			done: settings.thinkingLabel,
			active: settings.thinkingActiveLabel || `${settings.thinkingLabel}…`,
		};
	}
	if (settings.compactToolRows) {
		try {
			patchToolRowSpacing();
		} catch {
			// Leave pi's spacing untouched.
		}
	}
	if (settings.messageChrome) {
		try {
			patchUserMessage();
		} catch {
			// Leave pi's user message rendering untouched.
		}
		try {
			patchAssistantMessage();
		} catch {
			// Leave pi's assistant rendering untouched.
		}
	}
}

/**
 * Built-in tools re-registered with Copilot-style rows.
 *
 * Shape, matching Copilot CLI's timeline:
 *
 *   $ Shell  Read rust.md  67 lines
 *     cd repo && sed -n '88,130p' rust.md
 *
 *   Read src/auth.ts  732 lines
 *
 *   Edited src/auth.ts +12 -8
 *
 * The first line carries the tool name, a command summary (Copilot gets this
 * from the model's `intentionSummary`; pi has no such field, so it is derived
 * from the command) and the output size. Output itself appears only for
 * failures or when the row is expanded with ctrl+o.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createPowerShellToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

import {
	basename,
	countDiff,
	countEntries,
	countLines,
	countOutputLines,
	countReadLines,
	countSearchFiles,
	diffLines,
	displayPath,
	emptyComponent,
	fileBadge,
	formatDuration,
	fullLines,
	type LineComponent,
	lineComponent,
	type MarkerKind,
	markerFor,
	oneLine,
	paint,
	plural,
	rowLines,
	statSuffix,
	summarizeCommand,
	tailLines,
	textContent,
} from "./grammar.ts";
import type { CopilotStyleSettings } from "./settings.ts";

type Stats = { additions: number; deletions: number };

/** Body lines indented to the header column of the row above. */
function bodyComponent(theme: Theme | undefined, getLines: () => string[], indent: number): LineComponent {
	return lineComponent((width) => {
		const avail = Math.max(1, width - indent);
		const out: string[] = [];
		for (const line of getLines()) {
			if (line.trim() === "") {
				out.push("");
				continue;
			}
			out.push(`${" ".repeat(indent)}${truncateToWidth(line, avail, "…", false)}`);
		}
		return out;
	});
}

function quote(value: unknown): string {
	const text = oneLine(value);
	return text ? `"${text}"` : '""';
}

function editStatsFromArgs(args: any): Stats {
	const edits = Array.isArray(args?.edits) ? args.edits : [];
	let additions = 0;
	let deletions = 0;
	for (const edit of edits) {
		additions += countLines(edit?.newText);
		deletions += countLines(edit?.oldText);
	}
	return { additions, deletions };
}

/**
 * Store a value in the row's shared state and repaint once when it changes.
 *
 * The repaint is deferred: this runs inside pi's `updateDisplay()`, and
 * `invalidate()` re-enters it, which would append the row's children twice.
 */
function remember(context: any, key: string, value: unknown): void {
	const state = context?.state;
	if (!state) return;
	if (Object.is(state[key], value)) return;
	state[key] = value;
	const invalidate = context.invalidate;
	if (typeof invalidate !== "function" || state.pendingInvalidate) return;
	state.pendingInvalidate = true;
	setTimeout(() => {
		state.pendingInvalidate = false;
		invalidate();
	}, 0);
}

/** `  67 lines` / `  12 files found` / `  L88:130 (43 lines read)`, dim like Copilot. */
function statText(
	theme: Theme | undefined,
	value: unknown,
	singular: string,
	pluralForm?: string,
	verb?: string,
	range?: string,
): string {
	if (typeof value !== "number" || value <= 0) return "";
	const count = `${plural(value, singular, pluralForm)}${verb ? ` ${verb}` : ""}`;
	return paint(theme, "dim", range ? `  ${range} (${count})` : `  ${count}`);
}

/** `L88:130` for a partial read, matching Copilot's `view_range` hint. */
function readRange(offset: unknown, limit: unknown): string | undefined {
	const from = typeof offset === "number" && offset > 0 ? offset : undefined;
	const take = typeof limit === "number" && limit > 0 ? limit : undefined;
	if (from === undefined && take === undefined) return undefined;
	const start = from ?? 1;
	const end = take === undefined ? undefined : start + take - 1;
	return `L${start}:${end ?? "end"}`;
}

/**
 * Shell rows keep their prompt glyph while they run and succeed — `$` for bash,
 * `>` for PowerShell — and swap in `✗` / `!` / `-` when the call fails.
 */
function shellMarker(context: any, idle: MarkerKind): MarkerKind {
	if (context?.isError) return "error";
	if (context?.warning || context?.rejected) return "warning";
	if (context?.cancelled) return "cancelled";
	return idle;
}

/** Stop the live clock a running row started. */
function stopShellTick(state: any): void {
	if (!state?.tick) return;
	clearInterval(state.tick);
	state.tick = undefined;
}

/**
 * How long the command has been running, shown next to its line count.
 *
 * A finished row uses pi's `context.durationMs` — measured with a monotonic
 * clock and stored with the result, so it survives a reload — and the value is
 * also stashed in the row state, because the header is built by `renderCall`
 * and that is the one path pi is not guaranteed to hand the number to. While
 * the command runs the extension keeps its own clock and repaints once a
 * second, which is what pi's own shell rows do.
 */
function shellElapsedMs(context: any): number | undefined {
	const state = context?.state;
	const recorded = state?.durationMs;
	if (typeof recorded === "number") return recorded;

	const duration = context?.durationMs;
	if (typeof duration === "number") {
		stopShellTick(state);
		return duration;
	}

	if (!state) return undefined;
	if (context?.isPartial) {
		if (state.startedAt === undefined && context?.executionStarted) state.startedAt = Date.now();
		if (state.startedAt === undefined) return undefined;
		state.tick ??= setInterval(() => context.invalidate?.(), 1000);
		// Never hold a process open on a row that is still running when it exits.
		(state.tick as any)?.unref?.();
		return Date.now() - state.startedAt;
	}
	if (state.startedAt === undefined) return undefined;
	state.endedAt ??= Date.now();
	stopShellTick(state);
	return state.endedAt - state.startedAt;
}

/** `  1.4s`, dim, after the row's `N lines`. */
function durationSuffix(theme: Theme | undefined, ms: number | undefined): string {
	if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
	return paint(theme, "dim", `  ${formatDuration(ms)}`);
}

export function registerCopilotTools(pi: ExtensionAPI, cwd: string, settings: CopilotStyleSettings): void {
	const failedLines = settings.failedOutputLines;

	// --- read -----------------------------------------------------------
	const read = createReadToolDefinition(cwd);
	pi.registerTool({
		...read,
		renderShell: "self",
		renderCall(args: any, theme: any, context: any) {
			const path = displayPath(args?.path, cwd);
			const shown = context.expanded ? path : basename(path);
			const range = readRange(args?.offset, args?.limit);
			const suffix = statText(theme, context.state?.lines, "line", "lines", "read", range);
			const header = paint(theme, "text", `Read ${shown}`) + suffix;
			return lineComponent((width) =>
				rowLines({ theme, width, badge: fileBadge(args?.path), header }),
			);
		},
		renderResult(result: any, { expanded }: any, theme: any, context: any) {
			if (context.isPartial) return emptyComponent();
			const text = textContent(result);
			if (context.isError) {
				return bodyComponent(theme, () => tailLines(text, theme, "error", failedLines), 2);
			}
			remember(context, "lines", countReadLines(text));
			if (expanded && text) return bodyComponent(theme, () => fullLines(text, theme, "muted"), 2);
			return emptyComponent();
		},
	});

	// --- shell ----------------------------------------------------------
	// `bash` and `powershell` are the same row with a different label and prompt
	// glyph; which one a machine has depends on the platform, so both are
	// registered. bash keeps Copilot's `Shell`, PowerShell says `Pwsh`.
	const shellRows = (idle: MarkerKind, label: string) => ({
		renderShell: "self" as const,
		renderCall(args: any, theme: any, context: any) {
			const suffix =
				statText(theme, context.state?.lines, "line", "lines") +
				durationSuffix(theme, shellElapsedMs(context));
			const summary = summarizeCommand(args?.command);
			const header = `${paint(theme, "text", label)}  ${paint(theme, "muted", summary)}${suffix}`;
			return lineComponent((width) =>
				rowLines({
					theme,
					width,
					marker: shellMarker(context, idle),
					header,
					body: [paint(theme, "dim", oneLine(args?.command))],
					bodyIndent: 2,
				}),
			);
		},
		renderResult(result: any, { expanded }: any, theme: any, context: any) {
			const text = textContent(result);
			if (!context.isPartial) {
				remember(context, "lines", countOutputLines(text));
				// Settle the clock once: the header (rendered by `renderCall`) then reads
				// the same number, and the live interval stops.
				stopShellTick(context.state);
				const elapsed = shellElapsedMs(context);
				if (elapsed !== undefined) remember(context, "durationMs", elapsed);
			}
			if (!text.trim()) return emptyComponent();
			if (context.isPartial) {
				// Copilot keeps a short live tail under a running command.
				return bodyComponent(theme, () => tailLines(text, theme, "muted", failedLines), 2);
			}
			if (context.isError) {
				return bodyComponent(
					theme,
					() => (expanded ? fullLines(text, theme, "error") : tailLines(text, theme, "error", failedLines)),
					2,
				);
			}
			if (expanded) return bodyComponent(theme, () => fullLines(text, theme, "muted"), 2);
			return emptyComponent();
		},
	});

	pi.registerTool({ ...createBashToolDefinition(cwd), ...shellRows("shell", "Shell") });
	pi.registerTool({ ...createPowerShellToolDefinition(cwd), ...shellRows("pwsh", "Pwsh") });

	// --- grep -----------------------------------------------------------
	const grep = createGrepToolDefinition(cwd);
	pi.registerTool({
		...grep,
		renderShell: "self",
		renderCall(args: any, theme: any, context: any) {
			const target = args?.glob ? oneLine(args.glob) : displayPath(args?.path ?? ".", cwd);
			const suffix = statText(theme, context.state?.files, "file", "files", "found");
			const header = paint(theme, "text", `Search ${quote(args?.pattern)} in ${target}`) + suffix;
			return lineComponent((width) => rowLines({ theme, width, marker: "search", header }));
		},
		renderResult(result: any, { expanded }: any, theme: any, context: any) {
			if (context.isPartial) return emptyComponent();
			const text = textContent(result);
			if (context.isError) {
				return bodyComponent(theme, () => tailLines(text, theme, "error", failedLines), 2);
			}
			remember(context, "files", countSearchFiles(text));
			if (expanded && text) return bodyComponent(theme, () => fullLines(text, theme, "muted"), 2);
			return emptyComponent();
		},
	});

	// --- find -----------------------------------------------------------
	const find = createFindToolDefinition(cwd);
	pi.registerTool({
		...find,
		renderShell: "self",
		renderCall(args: any, theme: any, context: any) {
			const suffix = statText(theme, context.state?.files, "file", "files", "found");
			const header =
				paint(
					theme,
					"text",
					`Search ${oneLine(args?.pattern ?? "")} in ${displayPath(args?.path ?? ".", cwd)}`,
				) + suffix;
			return lineComponent((width) => rowLines({ theme, width, marker: "search", header }));
		},
		renderResult(result: any, { expanded }: any, theme: any, context: any) {
			if (context.isPartial) return emptyComponent();
			const text = textContent(result);
			if (context.isError) {
				return bodyComponent(theme, () => tailLines(text, theme, "error", failedLines), 2);
			}
			remember(context, "files", countEntries(text));
			if (expanded && text) return bodyComponent(theme, () => fullLines(text, theme, "muted"), 2);
			return emptyComponent();
		},
	});

	// --- ls -------------------------------------------------------------
	const ls = createLsToolDefinition(cwd);
	pi.registerTool({
		...ls,
		renderShell: "self",
		renderCall(args: any, theme: any, context: any) {
			const suffix = statText(theme, context.state?.entries, "entry", "entries");
			const header =
				paint(theme, "text", `List directory ${displayPath(args?.path ?? ".", cwd)}`) + suffix;
			return lineComponent((width) => rowLines({ theme, width, header }));
		},
		renderResult(result: any, { expanded }: any, theme: any, context: any) {
			if (context.isPartial) return emptyComponent();
			const text = textContent(result);
			if (context.isError) {
				return bodyComponent(theme, () => tailLines(text, theme, "error", failedLines), 2);
			}
			remember(context, "entries", countEntries(text));
			if (expanded && text) return bodyComponent(theme, () => fullLines(text, theme, "muted"), 2);
			return emptyComponent();
		},
	});

	// --- edit -----------------------------------------------------------
	const edit = createEditToolDefinition(cwd);
	pi.registerTool({
		...edit,
		renderShell: "self",
		renderCall(args: any, theme: any, context: any) {
			const verb = context.isError ? "Edit" : context.isPartial ? "Editing" : "Edited";
			const stats = (context.state?.stats as Stats | undefined) ?? editStatsFromArgs(args);
			const path = displayPath(args?.path, cwd);
			const shown = context.expanded ? path : basename(path);
			const header = paint(theme, "text", `${verb} ${shown}`) + statSuffix(theme, stats);
			return lineComponent((width) =>
				rowLines({ theme, width, badge: fileBadge(args?.path), header }),
			);
		},
		renderResult(result: any, { expanded }: any, theme: any, context: any) {
			const details = result?.details;
			if (typeof details?.diff === "string") remember(context, "stats", countDiff(details.diff));
			if (context.isPartial) return emptyComponent();
			const text = textContent(result);
			if (context.isError) {
				return bodyComponent(theme, () => tailLines(text, theme, "error", failedLines), 2);
			}
			if (expanded && typeof details?.diff === "string") {
				return bodyComponent(theme, () => diffLines(details.diff, theme), 2);
			}
			if (expanded && text) return bodyComponent(theme, () => fullLines(text, theme, "muted"), 2);
			return emptyComponent();
		},
	});

	// --- write ----------------------------------------------------------
	const write = createWriteToolDefinition(cwd);
	pi.registerTool({
		...write,
		renderShell: "self",
		renderCall(args: any, theme: any, context: any) {
			const verb = context.isError ? "Create" : context.isPartial ? "Creating" : "Created";
			const added = countLines(args?.content);
			const suffix = added > 0 ? paint(theme, "add", ` +${added}`) : "";
			const path = displayPath(args?.path, cwd);
			const shown = context.expanded ? path : basename(path);
			const header = paint(theme, "text", `${verb} ${shown}`) + suffix;
			return lineComponent((width) =>
				rowLines({ theme, width, badge: fileBadge(args?.path), header }),
			);
		},
		renderResult(result: any, { expanded }: any, theme: any, context: any) {
			if (context.isPartial) return emptyComponent();
			const text = textContent(result);
			if (context.isError) {
				return bodyComponent(theme, () => tailLines(text, theme, "error", failedLines), 2);
			}
			if (expanded && text) return bodyComponent(theme, () => fullLines(text, theme, "muted"), 2);
			return emptyComponent();
		},
	});

	// --- codemode -------------------------------------------------------
	// codemode is registered by pi's own built-in extension, never by this one, so
	// its row is attached with a tool-renderer resolver instead of re-registering
	// the tool definition. A settled row reads `JS Run codemode script  3 calls`:
	// the nested calls are the interesting part, so the count is on the header and
	// the detail sits one ctrl+o away.
	const SCRIPT_HEADER = /^Script (completed|failed)\nWall time [\d.]+ seconds\nOutput:\n/;

	const codemodeMarker = (context: any): MarkerKind => {
		if (context?.cancelled) return "cancelled";
		if (context?.warning || context?.rejected) return "warning";
		return markerFor(context);
	};

	/** `✓ read  12ms` / `✗ grep  30ms` — one nested call inside the script. */
	const codemodeCallLine = (call: any, theme: Theme | undefined): string => {
		const status = call?.status;
		const tone: Parameters<typeof paint>[1] =
			status === "error" ? "error" : status === "running" ? "warning" : status === "cancelled" ? "dim" : "success";
		const glyph = status === "error" ? "✗" : status === "running" ? "…" : status === "cancelled" ? "⊘" : "✓";
		const name = paint(theme, "text", oneLine(call?.name) || "call");
		// Nested calls are sub-second; tenths of a second would read `0.0s`.
		const ms = call?.durationMs;
		const elapsed = typeof ms === "number"
			? paint(theme, "dim", `  ${ms < 1000 ? `${Math.round(ms)}ms` : formatDuration(ms)}`)
			: "";
		return `${paint(theme, tone, glyph)} ${name}${elapsed}`;
	};

	/** Expanded body: the script, its nested calls, then the output. */
	const codemodeBody = (context: any, result: any, theme: Theme | undefined, output: string): string[] => {
		const lines: string[] = [];
		const code = typeof context?.args?.code === "string" ? context.args.code.replace(/\r/g, "").trimEnd() : "";
		if (code) lines.push(...fullLines(code, theme, "muted"));

		const calls = Array.isArray(result?.details?.calls) ? result.details.calls : [];
		if (calls.length > 0) {
			if (lines.length > 0) lines.push("");
			for (const call of calls) lines.push(codemodeCallLine(call, theme));
		}

		if (output) {
			if (lines.length > 0) lines.push("");
			lines.push(...fullLines(output, theme, context?.isError ? "error" : "muted"));
		}
		return lines;
	};

	// `registerToolRenderer` arrived after 1.5.0; without it codemode keeps pi's row.
	const registerToolRenderer = (pi as any).registerToolRenderer;
	if (typeof registerToolRenderer === "function") {
		registerToolRenderer.call(pi, (toolName: string, next: () => any) => {
			if (toolName !== "codemode") return next();

			return {
				renderShell: "self" as const,
				renderCall(args: any, theme: any, context: any) {
					const marker = codemodeMarker(context);
					// Under a second the timer would read `0.0s` on a row that just appeared.
					const running = shellElapsedMs(context);
					const suffix =
						statText(theme, context.state?.calls, "call", "calls") +
						statText(theme, context.state?.lines, "line", "lines") +
						durationSuffix(theme, typeof running === "number" && running >= 1000 ? running : undefined);
					const header = paint(theme, "text", "Run codemode script") + suffix;
					// The badge only holds the marker column on a settled row; a running or
					// failed call keeps the glyph so its state is never hidden.
					const badge = marker === "none" ? { label: "JS", tone: "accent" as const } : undefined;
					return lineComponent((width) => rowLines({ theme, width, marker, badge, header }));
				},
				renderResult(result: any, { expanded }: any, theme: any, context: any) {
					const calls = Array.isArray(result?.details?.calls) ? result.details.calls : [];
					if (calls.length > 0) remember(context, "calls", calls.length);
					// The tool prepends `Script completed\nWall time …\nOutput:\n`; it is noise
					// once the row says `Run script`, and it would inflate the line count.
					const output = textContent(result).replace(SCRIPT_HEADER, "").trim();

					if (!context.isPartial) {
						remember(context, "lines", countOutputLines(output));
						stopShellTick(context.state);
						const elapsed = shellElapsedMs(context);
						if (elapsed !== undefined) remember(context, "durationMs", elapsed);
					}

					if (expanded) {
						const body = codemodeBody(context, result, theme, output);
						if (body.length > 0) return bodyComponent(theme, () => body, 2);
					}
					if (context.isPartial) return emptyComponent();
					if (!output) return emptyComponent();
					if (context.isError) {
						return bodyComponent(theme, () => tailLines(output, theme, "error", failedLines), 2);
					}
					return emptyComponent();
				},
			};
		});
	}
}

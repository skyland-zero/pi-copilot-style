/**
 * Copilot-style transcript grammar.
 *
 * Mirrors the concise timeline Copilot CLI renders: one line per operation,
 * `$ ` in front of shell commands, no glyph on success, a marker only while an
 * operation runs or after it fails, and output only when something went wrong
 * (or when the row is expanded with ctrl+o).
 */

import { homedir } from "node:os";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type Tone =
	| "text"
	| "muted"
	| "dim"
	| "accent"
	| "success"
	| "error"
	| "warning"
	| "shell"
	| "add"
	| "remove";

export type MarkerKind =
	| "none"
	| "running"
	| "error"
	| "warning"
	| "cancelled"
	| "shell"
	| "pwsh"
	| "search";

export const GLYPH = {
	running: "●",
	error: "✗",
	warning: "!",
	cancelled: "-",
	shell: "$",
	// PowerShell's prompt is `PS>`; one character carries the same signal in the marker column.
	pwsh: ">",
	search: "/",
	thinking: "❯",
	user: "❯",
	assistant: "●",
} as const;

const MARKER_TONE: Record<Exclude<MarkerKind, "none">, Tone> = {
	running: "muted",
	error: "error",
	warning: "warning",
	cancelled: "dim",
	shell: "shell",
	pwsh: "shell",
	search: "dim",
};

const ELLIPSIS = "…";

/** Paint text with a pi theme token; unthemed output degrades to plain text. */
export function paint(theme: Theme | undefined, tone: Tone, text: string): string {
	if (!theme) return text;
	try {
		switch (tone) {
			case "muted":
				return theme.fg("muted", text);
			case "dim":
				return theme.fg("dim", text);
			case "accent":
				return theme.fg("accent", text);
			case "success":
				return theme.fg("success", text);
			case "error":
				return theme.fg("error", text);
			case "warning":
				return theme.fg("warning", text);
			case "shell":
				// Copilot tints the shell prefix amber/olive; pi's warning slot is the closest match.
				return theme.fg("warning", text);
			case "add":
				return theme.fg("toolDiffAdded", text);
			case "remove":
				return theme.fg("toolDiffRemoved", text);
			default:
				// Message bodies in pi use the terminal's foreground too; keeping
				// headers uncolored means a light/dark mismatch can't hide them.
				return text;
		}
	} catch {
		return text;
	}
}

/** Collapse a multi-line command or argument into a single transcript line. */
export function oneLine(text: unknown): string {
	return String(text ?? "")
		.replace(/\r\n?/g, "\n")
		.replace(/\s*\n\s*/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Copilot prints paths relative to the working directory and shortens the home
 * directory to `~`, so the row stays readable even when the model passes an
 * absolute path. Windows separators are normalised and compared
 * case-insensitively, since `C:\Users\x` and `c:\users\x` are one path there.
 */
export function displayPath(path: unknown, cwd: string): string {
	const text = oneLine(path);
	if (!text) return text;

	const slash = text.replace(/\\/g, "/");
	const lowerSlash = slash.toLowerCase();
	const base = (root: string) => root.replace(/\\/g, "/").replace(/\/+$/, "");
	const under = (root: string): string | undefined => {
		const rootBase = base(root);
		if (!rootBase || lowerSlash.length <= rootBase.length) return undefined;
		if (!lowerSlash.startsWith(`${rootBase.toLowerCase()}/`)) return undefined;
		return slash.slice(rootBase.length + 1);
	};

	if (cwd) {
		const relative = under(cwd);
		if (relative !== undefined) return relative;
	}
	const home = homedir();
	if (home) {
		const homeBase = base(home);
		if (homeBase && lowerSlash === homeBase.toLowerCase()) return "~";
		const relative = under(home);
		if (relative !== undefined) return `~/${relative}`;
	}
	return text;
}

const MULTI_LINE = /\r\n?/g;

/** Split a command into words, keeping quoted arguments (and their spaces) whole. */
function shellWords(input: string): string[] {
	const words: string[] = [];
	const characters = [...input];
	let current = "";
	let quote: "'" | "\"" | undefined;
	let escaped = false;
	for (let index = 0; index < characters.length; index += 1) {
		const character = characters[index] ?? "";
		if (escaped) {
			current += character;
			escaped = false;
			continue;
		}
		// Bash escapes with `\`, but a Windows path (`C:\Users\x`) is literal: only
		// treat the backslash as an escape when the next character needs one.
		if (character === "\\" && /[\s"'\\$`]/.test(characters[index + 1] ?? "")) {
			escaped = true;
			continue;
		}
		if (quote) {
			if (character === quote) quote = undefined;
			else current += character;
			continue;
		}
		if (character === "'" || character === "\"") {
			quote = character;
			continue;
		}
		if (/\s/.test(character)) {
			if (current !== "") {
				words.push(current);
				current = "";
			}
			continue;
		}
		current += character;
	}
	if (current !== "") words.push(current);
	return words;
}
const SHELL_KEYWORDS = new Set(["for", "while", "until", "if", "case", "select", "do", "then"]);

function nonFlagArgs(words: string[], from: number): string[] {
	return words
		.slice(from)
		.filter((word) => word !== "" && !word.startsWith("-") && !PUNCTUATION.test(word));
}

/** Pipeline separators and redirections: present in the words, never an argument. */
const PUNCTUATION = /^(?:\|+|&+|;|<<?|>>?|\d?>>?|\d?>&\d?)$/;

/** `Measure-Object` is the next stage of a pipeline, not a path. */
function isCmdlet(word: string): boolean {
	return /^[A-Z][A-Za-z]*-[A-Z]/.test(word);
}

function firstNonFlag(words: string[], from: number): string {
	const argument = nonFlagArgs(words, from).find((word) => !isCmdlet(word));
	return argument ?? "";
}

/** Last path argument, for `Copy-Item a b` and PowerShell's `-Destination` form. */
function lastNonFlag(words: string[], from: number): string {
	return nonFlagArgs(words, from).filter((word) => !isCmdlet(word)).pop() ?? "";
}

/**
 * Value of a PowerShell style flag (`-Pattern x`, `-Pattern:x`).
 *
 * PowerShell writes flags with a leading `-` and either a space or a colon, so
 * `Select-String -Path *.md -Pattern MIGRATION` has to be read from the flag
 * rather than from "the first bare word".
 */
function flagValue(words: string[], flag: string): string {
	const name = flag.toLowerCase();
	for (let index = 0; index < words.length; index += 1) {
		const word = (words[index] ?? "").toLowerCase();
		if (word === name) return words[index + 1] ?? "";
		if (word.startsWith(`${name}:`) || word.startsWith(`${name}=`)) {
			return (words[index] ?? "").slice(name.length + 1);
		}
	}
	return "";
}

function shellStages(command: string): string[] {
	const raw = command
		.replace(MULTI_LINE, "\n")
		.split(/\n|&&|\|\||;/)
		.map((stage) => stage.trim())
		.filter((stage) => stage !== "");

	const stages: string[] = [];
	for (const stage of raw) {
		// A continued line (`npm test` + `--watch`) belongs to the stage above it.
		if (stages.length > 0 && /^-/.test(stage)) stages[stages.length - 1] += ` ${stage}`;
		else stages.push(stage);
	}
	return stages.filter((stage) => !/^(?:cd|chdir|pushd|popd|set-location|sl)\b/i.test(stage));
}

/**
 * Copilot's row carries the model's `intentionSummary`. pi's tool calls have no
 * such field, so the summary is derived from the command: a verb for the first
 * pipeline stage plus how many further steps the line chains.
 */
export function summarizeCommand(command: unknown): string {
	const stages = shellStages(String(command ?? ""));
	const primary = stages[0] ?? "";
	if (!primary) return "Run shell command";

	let words = shellWords(primary);
	while (words.length > 0) {
		const head = words[0] ?? "";
		if (/^[A-Za-z_][A-Za-z\d_]*=/.test(head) || ["command", "env", "sudo", "time", "nohup"].includes(head.toLowerCase())) {
			words = words.slice(1);
			continue;
		}
		break;
	}

	const executable = (words[0] ?? "").replace(/^.*[\\/]/, "").replace(/\.(?:cmd|exe|ps1)$/i, "").toLowerCase();
	const action = (words[1] ?? "").toLowerCase();
	const subject = words[2] ?? "";
	const runtimes = ["npm", "pnpm", "yarn", "bun"];

	let summary: string;
	if (runtimes.includes(executable) && action === "run" && subject) summary = `Run ${subject} task`;
	else if (runtimes.includes(executable) && ["test", "check", "lint"].includes(action)) {
		summary = action === "test" ? "Run tests" : action === "check" ? "Run project checks" : "Run linter";
	} else if (runtimes.includes(executable) && ["install", "i", "ci"].includes(action)) summary = "Install dependencies";
	else if (executable === "git" && action === "status") summary = "Check repository status";
	else if (executable === "git" && action === "diff") summary = "Review repository changes";
	else if (executable === "git" && action === "log") summary = "Review commit history";
	else if (executable === "git" && action === "grep") summary = "Search repository history";
	else if (executable === "git" && ["fetch", "pull", "push", "clone", "commit", "add"].includes(action)) {
		summary = `${action[0]?.toUpperCase() ?? ""}${action.slice(1)} repository`;
	} else if (["rg", "grep", "egrep", "ag", "ack", "select-string"].includes(executable)) {
		// `Select-String -Path *.md -Pattern MIGRATION` names both, so prefer the flag.
		const pattern = flagValue(words, "-pattern") || firstNonFlag(words, 1);
		const where = flagValue(words, "-path");
		const quoted = pattern.length > 32 ? `${pattern.slice(0, 31)}…` : pattern;
		summary = pattern ? `Search ${quoted}${where ? ` in ${where}` : ""}` : "Search files";
	} else if (["find", "fd", "ls", "dir", "get-childitem", "tree"].includes(executable)) {
		const target = firstNonFlag(words, 1);
		// `Get-ChildItem | Measure-Object` is a count, not a listing of "Count".
		summary = words.some((word) => word.toLowerCase() === "measure-object")
			? "Count items"
			: target
				? `Find ${target}`
				: "List files";
	} else if (["get-content", "gc", "type", "get-item", "import-csv"].includes(executable)) {
		const target = firstNonFlag(words, 1);
		summary = target ? `Read ${target}` : "Read files";
	} else if (["set-content", "add-content", "out-file", "new-item", "set-item"].includes(executable)) {
		const target = firstNonFlag(words, 1);
		summary = target ? `Write ${target}` : "Write file";
	} else if (["remove-item", "clear-content", "del", "erase"].includes(executable)) {
		const target = lastNonFlag(words, 1);
		summary = target ? `Remove ${target}` : "Remove file";
	} else if (["copy-item", "move-item", "rename-item"].includes(executable)) {
		const verb = executable.startsWith("copy") ? "Copy" : executable.startsWith("move") ? "Move" : "Rename";
		// `Copy-Item a b` / `Copy-Item -Path a -Destination b`: the last bare word is the target.
		const target = lastNonFlag(words, 1);
		summary = target ? `${verb} ${target}` : `${verb} file`;
	} else if (["invoke-webrequest", "invoke-restmethod", "iwr", "irm"].includes(executable)) {
		summary = "Fetch URL";
	} else if (executable === "test-path") {
		const target = firstNonFlag(words, 1);
		summary = target ? `Check ${target}` : "Check path";
	} else if (["write-output", "write-host"].includes(executable)) summary = "Print output";
	else if (["touch", "mkdir", "rm", "rmdir", "cp", "mv", "ln"].includes(executable)) {
		const verb: Record<string, string> = {
			touch: "Update",
			mkdir: "Create",
			rmdir: "Remove",
			rm: "Remove",
			cp: "Copy",
			mv: "Move",
			ln: "Link",
		};
		const target = firstNonFlag(words, 1);
		summary = target ? `${verb[executable] ?? "Change"} ${target}` : `${verb[executable] ?? "Change"} file`;
	} else if (["sed", "awk"].includes(executable)) {
		// `sed -n '88,130p' file` — the script comes first, the file after it.
		const args = nonFlagArgs(words, 1);
		const target = args[1] ?? args[0] ?? "";
		summary = target ? `Read ${target}` : "Read files";
	} else if (["cat", "head", "tail", "bat", "less", "more", "nl", "wc"].includes(executable)) {
		const target = firstNonFlag(words, 1);
		summary = target ? `Read ${target}` : "Read files";
	} else if (["tsc", "mypy", "pyright", "tsserver"].includes(executable)) summary = "Check types";
	else if (["cargo", "rustc", "go", "dotnet", "make", "cmake", "gradle", "mvn"].includes(executable)) {
		summary = action ? `Run ${executable} ${action}` : `Run ${executable}`;
	} else if (["jest", "vitest", "pytest", "mocha", "bats"].includes(executable)) summary = "Run tests";
	else if (["python", "python3", "node", "bun", "deno", "sh", "bash", "zsh"].includes(executable)) {
		summary = action && action.startsWith("-") ? `Run ${executable} script` : "Run script";
	} else if (SHELL_KEYWORDS.has(executable)) summary = "Run shell script";
	else if (executable === "echo" || executable === "printf") summary = "Print output";
	else if (executable) summary = `Run ${executable.replace(/[-_]+/g, " ")}`;
	else summary = "Run shell command";

	return summary;
}

/** Non-empty output lines, the `N lines` figure Copilot prints after a row. */
export function countOutputLines(text: string): number {
	if (!text) return 0;
	return text.split(/\r\n?|\n/).filter((line) => line.trim() !== "").length;
}

/**
 * Lines a read returned. pi appends a `[N more lines in file …]` footer, which
 * is not part of what was read, so it is dropped before counting.
 */
export function countReadLines(text: string): number {
	const lines = String(text ?? "").split(/\r\n?|\n/);
	while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") lines.pop();
	while (lines.length > 0 && /^\[.*\]$/.test(lines[lines.length - 1]?.trim() ?? "")) {
		lines.pop();
		while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") lines.pop();
	}
	return lines.length;
}

/** Path part of `path:line:match`, used to count files a search touched. */
export function countSearchFiles(text: string): number {
	if (!text) return 0;
	const files = new Set<string>();
	for (const line of text.split(/\r\n?|\n/)) {
		if (line.trim() === "") continue;
		const match = line.match(/^(.+?):\d+:/) ?? line.match(/^(.+?):\d+$/);
		files.add(match?.[1] ?? line.trim());
	}
	return files.size;
}

export function countEntries(text: string): number {
	return countOutputLines(text);
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * `4.2s` below a minute, then `1m 30s` and `2h 3m 4s` — the scale pi's own tool
 * rows use. pi's formatter is not exported from the package entry, so the
 * grammar keeps its own copy of the rule.
 */
export function formatDuration(ms: number): string {
	const seconds = Math.max(0, ms) / 1000;
	// Round to the displayed precision first, so 59.97s reads `1m 0s` rather than `60.0s`.
	const tenths = Math.round(seconds * 10) / 10;
	if (tenths < 60) return `${tenths.toFixed(1)}s`;
	const totalSeconds = Math.floor(tenths);
	const minutes = Math.floor(totalSeconds / 60);
	const remainder = totalSeconds % 60;
	if (minutes < 60) return `${minutes}m ${remainder}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainder}s`;
}

/**
 * Copilot's file badges: two characters per extension, colored by language.
 * Taken from the CLI's own table so `cs` reads `C#` and `json` reads `{}`.
 */
const FILE_BADGES: Record<string, { label: string; tone: Tone }> = {
	ts: { label: "TS", tone: "accent" },
	mts: { label: "TS", tone: "accent" },
	cts: { label: "TS", tone: "accent" },
	tsx: { label: "TX", tone: "accent" },
	js: { label: "JS", tone: "warning" },
	mjs: { label: "JS", tone: "warning" },
	cjs: { label: "JS", tone: "warning" },
	jsx: { label: "JX", tone: "warning" },
	json: { label: "{}", tone: "success" },
	md: { label: "MD", tone: "muted" },
	mdx: { label: "MX", tone: "muted" },
	rs: { label: "RS", tone: "error" },
	py: { label: "PY", tone: "accent" },
	go: { label: "GO", tone: "accent" },
	rb: { label: "RB", tone: "error" },
	java: { label: "JV", tone: "error" },
	c: { label: "C", tone: "accent" },
	h: { label: "H", tone: "accent" },
	cpp: { label: "C+", tone: "accent" },
	cc: { label: "C+", tone: "accent" },
	cs: { label: "C#", tone: "success" },
	sh: { label: "SH", tone: "muted" },
	bash: { label: "SH", tone: "muted" },
	yaml: { label: "YM", tone: "muted" },
	yml: { label: "YM", tone: "muted" },
	toml: { label: "TM", tone: "muted" },
	html: { label: "HT", tone: "warning" },
	css: { label: "SS", tone: "accent" },
	scss: { label: "SS", tone: "accent" },
	sql: { label: "SQ", tone: "success" },
};

export interface FileBadge {
	label: string;
	tone: Tone;
}

/** Badge for a path's extension, or `undefined` for directories and unknown types. */
export function fileBadge(path: unknown): FileBadge | undefined {
	const name = String(path ?? "").split(/[\\/]/).pop() ?? "";
	const dot = name.lastIndexOf(".");
	if (dot <= 0 || dot === name.length - 1) return undefined;
	return FILE_BADGES[name.slice(dot + 1).toLowerCase()];
}

/** Last path segment, the form Copilot shows while a file row is collapsed. */
export function basename(path: unknown): string {
	const text = oneLine(path);
	if (!text) return text;
	const segments = text.split(/[\\/]/).filter((segment) => segment !== "");
	return segments[segments.length - 1] ?? text;
}

export interface RowSpec {
	theme?: Theme;
	width: number;
	marker?: MarkerKind;
	/** Two-character file badge; replaces the marker column when present. */
	badge?: FileBadge;
	/** Literal prefix rendered between the marker and the header, e.g. `$ `. */
	prefix?: string;
	prefixTone?: Tone;
	/** Single-line, already painted header. */
	header: string;
	/** Already painted trailing detail (duration, counts). */
	suffix?: string;
	/** Already painted body lines, shown below the header. */
	body?: string[];
	/** Body indent override; defaults to the header's start column. */
	bodyIndent?: number;
}

/**
 * Build the lines for one operation row.
 *
 * Layout follows Copilot's `YR` component: a one-column marker, one gap column,
 * an optional two-column prefix, then the header. The body is indented to the
 * header column.
 */
export function rowLines(spec: RowSpec): string[] {
	const width = Math.max(1, spec.width);
	const marker = spec.marker ?? "none";
	const badge = spec.badge;
	let markerCell: string;
	let markerWidth: number;
	if (badge) {
		markerCell = paint(spec.theme, badge.tone, badge.label.padEnd(2).slice(0, 2));
		markerWidth = 2;
	} else {
		markerWidth = 1;
		markerCell = marker === "none" ? " " : paint(spec.theme, MARKER_TONE[marker], GLYPH[marker]);
	}
	const prefix = spec.prefix ?? "";
	const prefixWidth = prefix ? visibleWidth(prefix) : 0;
	const headerIndent = markerWidth + 1 + prefixWidth;

	let line = `${markerCell} `;
	if (prefix) line += paint(spec.theme, spec.prefixTone ?? "shell", prefix);
	line += spec.header;
	if (spec.suffix) line += spec.suffix;

	const lines = [truncateToWidth(line, width, ELLIPSIS, false)];
	const indent = spec.bodyIndent ?? headerIndent;
	const avail = Math.max(1, width - indent);
	for (const bodyLine of spec.body ?? []) {
		if (bodyLine.trim() === "") {
			lines.push("");
			continue;
		}
		lines.push(`${" ".repeat(indent)}${truncateToWidth(bodyLine, avail, ELLIPSIS, false)}`);
	}
	return lines;
}

export interface LineComponent {
	render(width: number): string[];
	invalidate(): void;
}

/** Minimal pi-tui component: caches by width, exactly what tool rows need. */
export function lineComponent(build: (width: number) => string[]): LineComponent {
	let cache: { width: number; lines: string[] } | undefined;
	return {
		render(width: number): string[] {
			if (!cache || cache.width !== width) {
				const lines = build(width);
				cache = { width, lines: lines.length > 0 ? lines : [] };
			}
			return cache.lines;
		},
		invalidate(): void {
			cache = undefined;
		},
	};
}

export function emptyComponent(): LineComponent {
	return lineComponent(() => []);
}

/** Marker for a tool row: only running and failed operations get one. */
export function markerFor(context: any): MarkerKind {
	if (context?.isError) return "error";
	if (context?.executionStarted && context?.isPartial) return "running";
	return "none";
}

/** Join the text blocks of a tool result. */
export function textContent(result: any): string {
	const parts: string[] = [];
	for (const block of result?.content ?? []) {
		if (block && block.type === "text" && typeof block.text === "string") parts.push(block.text);
	}
	return parts.join("\n");
}

/** Last N non-empty lines plus Copilot's `… N earlier lines` notice. */
export function tailLines(text: string, theme: Theme | undefined, tone: Tone, maxLines: number): string[] {
	const all = text
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.filter((line) => line.trim() !== "");
	if (all.length === 0) return [];
	const shown = maxLines > 0 ? all.slice(-maxLines) : all;
	const earlier = all.length - shown.length;
	const lines: string[] = [];
	if (earlier > 0) {
		lines.push(paint(theme, "dim", `… ${earlier} earlier ${earlier === 1 ? "line" : "lines"}`));
	}
	for (const line of shown) lines.push(paint(theme, tone, line));
	return lines;
}

/** Every line of a result, used when the row is expanded with ctrl+o. */
export function fullLines(text: string, theme: Theme | undefined, tone: Tone): string[] {
	const all = text.replace(/\r\n?/g, "\n").split("\n");
	while (all.length > 0 && all[all.length - 1] === "") all.pop();
	return all.map((line) => (line.trim() === "" ? "" : paint(theme, tone, line)));
}

/** Colorize a unified diff: `+` added, `-` removed, everything else secondary. */
export function diffLines(diff: string, theme: Theme | undefined): string[] {
	const all = diff.replace(/\r\n?/g, "\n").split("\n");
	while (all.length > 0 && all[all.length - 1] === "") all.pop();
	return all.map((line) => {
		if (line.startsWith("+++") || line.startsWith("---")) return paint(theme, "dim", line);
		if (line.startsWith("+")) return paint(theme, "add", line);
		if (line.startsWith("-")) return paint(theme, "remove", line);
		return paint(theme, "muted", line);
	});
}

export function countDiff(diff: string | undefined): { additions: number; deletions: number } {
	if (!diff) return { additions: 0, deletions: 0 };
	let additions = 0;
	let deletions = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) additions++;
		else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
	}
	return { additions, deletions };
}

export function countLines(text: unknown): number {
	if (typeof text !== "string" || text === "") return 0;
	return text.replace(/\n$/, "").split("\n").length;
}

/** ` +12` / ` -8` stat suffix, painted green/red like Copilot file-change rows. */
export function statSuffix(
	theme: Theme | undefined,
	stats: { additions: number; deletions: number },
	showZeroAdds = true,
): string {
	let suffix = "";
	if (stats.additions > 0 || (showZeroAdds && stats.deletions > 0)) {
		suffix += paint(theme, "add", ` +${stats.additions}`);
	}
	if (stats.deletions > 0) suffix += paint(theme, "remove", ` -${stats.deletions}`);
	return suffix;
}

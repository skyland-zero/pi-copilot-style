/**
 * pi-copilot-style — GitHub Copilot CLI's concise timeline for pi.
 *
 * One line per tool call: `$ command`, `Read path`, `Search "pattern" in *.ts`,
 * `Created path +12`, `Edited path +12 -8`. Successful operations show no output
 * at all; failures print the last few lines plus `… N earlier lines`. ctrl+o
 * expands a row, which is the same key Copilot uses.
 *
 * Config lives under `copilotStyle` in `<agent-dir>/settings.json` or
 * `<project>/.pi/settings.json`.
 */

import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type ExtensionAPI, getAgentDir, type Theme } from "@earendil-works/pi-coding-agent";

import { applyChromePatches, noteAssistantMessageEnd, noteAssistantMessageStart } from "./chrome.ts";
import { describeSettings, loadSettings } from "./settings.ts";
import { registerCopilotTools } from "./tools.ts";
import { GLYPH, lineComponent, paint, rowLines } from "./grammar.ts";

const BUNDLED_THEMES = ["copilot-dark", "copilot-light"] as const;

/**
 * Themes must live in `<agent-dir>/themes/` to resolve at startup: pi picks the
 * saved theme before extension resource discovery runs, so a theme that is only
 * registered through `resources_discover` fails with "Theme not found".
 */
function installThemes(extensionDir: string): void {
	try {
		const target = join(getAgentDir(), "themes");
		mkdirSync(target, { recursive: true });
		for (const name of BUNDLED_THEMES) {
			const source = join(extensionDir, "themes", `${name}.json`);
			const destination = join(target, `${name}.json`);
			let stale = false;
			try {
				stale = statSync(destination).mtimeMs < statSync(source).mtimeMs;
			} catch {
				stale = true;
			}
			if (stale) copyFileSync(source, destination);
		}
	} catch {
		// A read-only agent dir just means the bundled themes stay unavailable.
	}
}

function previewLines(width: number, theme: Theme | undefined): string[] {
	const lines: string[] = [];
	const label = (text: string) => lines.push(paint(theme, "dim", text));

	label("working");
	lines.push(
		...rowLines({
			theme,
			width,
			marker: "running",
			prefix: "$ ",
			header: paint(theme, "muted", "npm test"),
			body: [paint(theme, "muted", "› jest --watch"), paint(theme, "muted", "PASS src/auth.test.ts")],
			bodyIndent: 4,
		}),
	);
	lines.push("");
	label("failed with output");
	lines.push(
		...rowLines({
			theme,
			width,
			marker: "error",
			prefix: "$ ",
			header: paint(theme, "muted", "npm run build"),
			body: [
				paint(theme, "dim", "… 3 earlier lines"),
				paint(theme, "error", "src/auth.ts(42,7): error TS2322"),
				paint(theme, "error", "Command exited with code 1"),
			],
			bodyIndent: 4,
		}),
	);
	lines.push("");
	label("successful operations (no output, no glyph)");
	for (const row of [
		{ header: "Read src/auth.ts" },
		{ header: 'Search "useAuth" in **/*.ts' },
		{ header: "List src/hooks" },
	]) {
		lines.push(...rowLines({ theme, width, header: paint(theme, "text", row.header) }));
	}
	lines.push(
		...rowLines({
			theme,
			width,
			badge: { label: "JS", tone: "accent" },
			header: paint(theme, "text", "Run codemode script") + paint(theme, "dim", "  3 calls  12 lines  1.4s"),
		}),
	);
	lines.push(
		...rowLines({
			theme,
			width,
			header: paint(theme, "text", "Created src/session.ts") + paint(theme, "add", " +24"),
		}),
	);
	lines.push(
		...rowLines({
			theme,
			width,
			header:
				paint(theme, "text", "Edited src/auth.ts") +
				paint(theme, "add", " +12") +
				paint(theme, "remove", " -8"),
		}),
	);
	lines.push("");
	label("messages");
	lines.push(`${paint(theme, "accent", GLYPH.user)} refactor the login flow`);
	lines.push(`${paint(theme, "accent", GLYPH.assistant)} Reused refreshSession(token) in the refresh path.`);
	lines.push("");
	lines.push(paint(theme, "dim", "esc closes · ctrl+o expands a real row"));
	return lines;
}

export default function copilotStyle(pi: ExtensionAPI): void {
	const settings = loadSettings(process.cwd());
	if (!settings.enabled) return;

	let themeRef: Theme | undefined;
	const getTheme = () => themeRef;

	registerCopilotTools(pi, process.cwd(), settings);
	applyChromePatches(getTheme, settings);

	// Ship the Copilot palette so the badge/status colors match the real CLI.
	// Installed into `<agent-dir>/themes/` rather than registered through
	// `resources_discover`: the saved theme is resolved at startup, before
	// extension discovery, and registering both places triggers "[Theme conflicts]".
	installThemes(dirname(fileURLToPath(import.meta.url)));

	// Time the assistant turn so the reasoning row can say `Thought for 3s`.
	pi.on("message_start", async (event) => {
		if (event?.message?.role === "assistant") noteAssistantMessageStart(event.message);
	});
	pi.on("message_end", async (event) => {
		if (event?.message?.role === "assistant") noteAssistantMessageEnd(event.message);
	});

	// pi's working animation above the editor is left exactly as it ships.
	pi.on("session_start", async (_event, ctx) => {
		try {
			themeRef = ctx.ui?.theme;
		} catch {
			themeRef = undefined;
		}
		if (settings.thinkingLabel) {
			try {
				ctx.ui.setHiddenThinkingLabel(settings.thinkingLabel);
			} catch {
				// Older hosts may not expose the label.
			}
		}
	});

	pi.registerCommand("copilot-style", {
		description: "Copilot-style rendering: /copilot-style [status|preview]",
		handler: async (args, ctx) => {
			const sub = String(args ?? "").trim().toLowerCase();
			if (sub === "preview") {
				if (ctx.mode !== "tui") {
					ctx.ui.notify("preview needs interactive mode", "warning");
					return;
				}
				await ctx.ui.custom<void>((_tui, theme, keybindings, done) => {
					let cache: { width: number; lines: string[] } | undefined;
					const component = lineComponent((width) => previewLines(width, theme));
					return {
						render(width: number) {
							if (cache && cache.width === width) return cache.lines;
							const lines = component.render(width);
							cache = { width, lines };
							return lines;
						},
						invalidate() {
							cache = undefined;
							component.invalidate();
						},
						handleInput(data: string) {
							if (
								keybindings.matches(data, "tui.select.cancel") ||
								keybindings.matches(data, "tui.select.confirm")
							) {
								done(undefined);
							}
						},
					};
				});
				return;
			}
			if (sub === "theme") {
				try {
					const appearance = ctx.ui.theme?.appearance === "light" ? "light" : "dark";
					const name = `copilot-${appearance}`;
					ctx.ui.setTheme(name);
					ctx.ui.notify(`Theme set to ${name} (GitHub/Copilot palette)`, "info");
				} catch (error) {
					ctx.ui.notify(`Could not switch theme: ${String(error)}`, "error");
				}
				return;
			}
			ctx.ui.notify(
				`pi-copilot-style\n${describeSettings(settings)}\n\n/copilot-style theme — switch to the Copilot palette`,
				"info",
			);
		},
	});
}

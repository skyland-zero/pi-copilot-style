import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface CopilotStyleSettings {
	/** Master switch. Off means the extension registers nothing. */
	enabled: boolean;
	/** `❯` user rows and `●` assistant rows instead of pi's boxes. */
	messageChrome: boolean;
	/** Drop the blank line pi puts in front of every tool row. */
	compactToolRows: boolean;
	/** Lines of output shown under a failed row before expanding. */
	failedOutputLines: number;
	/** Label once reasoning has finished; rendered as `❯ Thought` (or `❯ Thought for 3s`). */
	thinkingLabel: string;
	/** Label while reasoning is still streaming; rendered as `❯ Thinking…`. */
	thinkingActiveLabel: string;
}

export const DEFAULT_SETTINGS: CopilotStyleSettings = {
	enabled: true,
	messageChrome: true,
	compactToolRows: true,
	failedOutputLines: 6,
	thinkingLabel: "Thought",
	thinkingActiveLabel: "Thinking…",
};

function readJson(path: string): unknown {
	try {
		if (!existsSync(path)) return undefined;
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
}

function num(value: unknown, fallback: number, min: number, max: number): number {
	const parsed = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, Math.round(parsed)));
}

function bool(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function str(value: unknown, fallback: string): string {
	return typeof value === "string" ? value.trim() : fallback;
}

/**
 * Read `copilotStyle` from the project `.pi/settings.json`, then the agent
 * settings file. Both are optional; unknown keys are ignored.
 */
export function loadSettings(cwd: string): CopilotStyleSettings {
	const sources = [join(getAgentDir(), "settings.json"), join(cwd, ".pi", "settings.json")];
	let settings: CopilotStyleSettings = { ...DEFAULT_SETTINGS };
	for (const path of sources) {
		const raw = readJson(path) as { copilotStyle?: Record<string, unknown> } | undefined;
		const block = raw?.copilotStyle;
		if (!block || typeof block !== "object") continue;
		settings = {
			enabled: bool(block.enabled, settings.enabled),
			messageChrome: bool(block.messageChrome, settings.messageChrome),
			compactToolRows: bool(block.compactToolRows, settings.compactToolRows),
			failedOutputLines: num(block.failedOutputLines, settings.failedOutputLines, 0, 50),
			thinkingLabel: str(block.thinkingLabel, settings.thinkingLabel),
			thinkingActiveLabel: str(block.thinkingActiveLabel, settings.thinkingActiveLabel),
		};
	}
	return settings;
}

export function describeSettings(settings: CopilotStyleSettings): string {
	return [
		`enabled: ${settings.enabled}`,
		`messageChrome: ${settings.messageChrome}`,
		`compactToolRows: ${settings.compactToolRows}`,
		`failedOutputLines: ${settings.failedOutputLines}`,
		`thinkingLabel: ${settings.thinkingLabel || "(pi default)"}`,
		`thinkingActiveLabel: ${settings.thinkingActiveLabel || "(same as thinkingLabel)"}`,
	].join("\n");
}

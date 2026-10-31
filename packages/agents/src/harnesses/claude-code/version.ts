/**
 * Which Claude Code is installed, for what only newer versions do.
 *
 * - `claude -p` leaves its thinking out unless `--thinking-display
 *   summarized` asks for it, and versions before 2.1.94 exit on that flag.
 *   Claude Code also exits 0 on `<unknown flag> --version`, so only the
 *   version can tell.
 * - From 2.1.128 on, the commands Claude Code runs (Bash, hooks, MCP
 *   servers) do not inherit its `OTEL_*` variables, so the export's
 *   headers reach Claude Code's own telemetry only.
 */
import { firstLine, probe } from "../../doctor";

type Version = readonly [number, number, number];

/** The first Claude Code that knows `--thinking-display`. */
const THINKING_DISPLAY_SINCE: Version = [2, 1, 94];

/** The first Claude Code whose commands do not inherit its `OTEL_*` variables. */
const OTEL_KEPT_SINCE: Version = [2, 1, 128];

/** The version in `claude --version` (`2.1.314 (Claude Code)`), or null. */
export function claudeCodeVersion(
	output: string,
): [number, number, number] | null {
	const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(firstLine(output) ?? "");
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Is `version` `since` or later? No version: no. */
function atLeast(version: Version | null, since: Version): boolean {
	if (!version) return false;
	for (let i = 0; i < 3; i++) {
		const have = version[i] ?? 0;
		const need = since[i] ?? 0;
		if (have !== need) return have > need;
	}
	return true;
}

/** Does this version know `--thinking-display`? */
export function knowsThinkingDisplay(version: Version | null): boolean {
	return atLeast(version, THINKING_DISPLAY_SINCE);
}

/** Does this version keep its `OTEL_*` variables from the commands it runs? */
export function keepsOtelFromCommands(version: Version | null): boolean {
	return atLeast(version, OTEL_KEPT_SINCE);
}

/** One probe per executable, for the life of the process. */
const versions = new Map<string, Promise<Version | null>>();

/**
 * The version of the `claude` of `executable`. It runs `<executable>
 * --version` once and keeps the answer. A probe that fails or says no
 * version gives null. The executable splits on spaces, as the adapter
 * splits it.
 */
function claudeVersionOf(
	executable: string,
	run: (argv: string[]) => ReturnType<typeof probe>,
): Promise<Version | null> {
	const known = versions.get(executable);
	if (known) return known;
	const answer = run([...executable.split(" ").filter(Boolean), "--version"])
		.then((out) => (out.code === 0 ? claudeCodeVersion(out.stdout) : null))
		.catch(() => null);
	versions.set(executable, answer);
	return answer;
}

/**
 * Does the `claude` of `executable` know `--thinking-display`? No version:
 * no, and the session runs without the flag.
 */
export async function claudeKnowsThinkingDisplay(
	executable: string,
	run: (argv: string[]) => ReturnType<typeof probe> = probe,
): Promise<boolean> {
	return knowsThinkingDisplay(await claudeVersionOf(executable, run));
}

/**
 * Does the `claude` of `executable` keep its `OTEL_*` variables from the
 * commands it runs? No version: no, and the session gets no OTLP headers.
 */
export async function claudeKeepsOtelFromCommands(
	executable: string,
	run: (argv: string[]) => ReturnType<typeof probe> = probe,
): Promise<boolean> {
	return keepsOtelFromCommands(await claudeVersionOf(executable, run));
}

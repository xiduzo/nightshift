/**
 * Which Claude Code is installed, for the flags only newer versions know.
 * `claude -p` leaves its thinking out unless `--thinking-display summarized`
 * asks for it, and versions before 2.1.94 exit on that flag. Claude Code
 * also exits 0 on `<unknown flag> --version`, so only the version can tell.
 */
import { firstLine, probe } from "../../doctor";

/** The first Claude Code that knows `--thinking-display`. */
const THINKING_DISPLAY_SINCE = [2, 1, 94] as const;

/** The version in `claude --version` (`2.1.314 (Claude Code)`), or null. */
export function claudeCodeVersion(
	output: string,
): [number, number, number] | null {
	const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(firstLine(output) ?? "");
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Does this version know `--thinking-display`? */
export function knowsThinkingDisplay(
	version: readonly [number, number, number] | null,
): boolean {
	if (!version) return false;
	for (let i = 0; i < 3; i++) {
		const have = version[i] ?? 0;
		const need = THINKING_DISPLAY_SINCE[i] ?? 0;
		if (have !== need) return have > need;
	}
	return true;
}

/** One probe per executable, for the life of the process. */
const thinkingDisplay = new Map<string, Promise<boolean>>();

/**
 * Does the `claude` of `executable` know `--thinking-display`? It runs
 * `<executable> --version` once and keeps the answer. A probe that fails
 * or says no version gives false: the session then runs without the flag.
 * The executable splits on spaces, as the adapter splits it.
 */
export function claudeKnowsThinkingDisplay(
	executable: string,
	run: (argv: string[]) => ReturnType<typeof probe> = probe,
): Promise<boolean> {
	const known = thinkingDisplay.get(executable);
	if (known) return known;
	const answer = run([...executable.split(" ").filter(Boolean), "--version"])
		.then(
			(out) =>
				out.code === 0 && knowsThinkingDisplay(claudeCodeVersion(out.stdout)),
		)
		.catch(() => false);
	thinkingDisplay.set(executable, answer);
	return answer;
}

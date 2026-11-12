import type { HarnessSetupFacts } from "@nightshift/agents/harness-facts";

import { plainText, tailOf } from "./plain-text";
import type { SetupSpawn } from "./spawn";

/**
 * The install of an agent CLI with its vendor's own script (ADR 25). What
 * runs comes only from the harness's fixed setup data, never from a
 * request: `curl -fsSL <script> | <shell>`, as the vendor documents it. It
 * runs without input and without a terminal, so it cannot ask for a
 * password: it never runs as an administrator. A timeout stops it.
 */

/** How long an install may take before Night Shift stops it. */
export const INSTALL_TIMEOUT_MS = 10 * 60_000;

/** How much of the installer's output a failed install keeps for the person. */
const OUTPUT_TAIL_CHARS = 2_000;
/** How much output the install keeps while it runs: the tail comes from it. */
const OUTPUT_KEPT_CHARS = 32_000;

/** The exact text of what an install runs: the vendor's own command. */
export function installCommand(setup: HarnessSetupFacts): string {
	return `curl -fsSL ${setup.installScript} | ${setup.installShell}`;
}

/** How an install ended. `output` is the end of what the installer printed. */
export type InstallEnd =
	| { kind: "done"; output: string }
	| { kind: "failed"; code: number; output: string }
	| { kind: "timed-out"; output: string }
	| { kind: "stopped" };

/** One install that runs: stop it, or wait for its end. */
export type RunningInstall = {
	stop(): void;
	ended: Promise<InstallEnd>;
};

/** Starts the vendor's installer in the home folder. Throws when it cannot start. */
export function startInstall(input: {
	setup: HarnessSetupFacts;
	spawn: SetupSpawn;
	home: string;
	env: Readonly<Record<string, string | undefined>>;
	timeoutMs?: number;
}): RunningInstall {
	const { setup, spawn, home, env } = input;
	let output = "";
	let stopped: "timeout" | "stop" | null = null;
	const proc = spawn(["/bin/sh", "-c", installCommand(setup)], {
		cwd: home,
		env: { ...env, ...setup.installEnv },
		io: "pipes",
		input: false,
		onOutput: (text) => {
			output = (output + text).slice(-OUTPUT_KEPT_CHARS);
		},
	});
	const timer = setTimeout(() => {
		stopped = "timeout";
		proc.stop();
	}, input.timeoutMs ?? INSTALL_TIMEOUT_MS);
	const tail = () => tailOf(plainText(output), OUTPUT_TAIL_CHARS);
	const ended = proc.exited.then(
		(code): InstallEnd => {
			clearTimeout(timer);
			if (stopped === "stop") return { kind: "stopped" };
			if (stopped === "timeout") return { kind: "timed-out", output: tail() };
			return code === 0
				? { kind: "done", output: tail() }
				: { kind: "failed", code, output: tail() };
		},
		(): InstallEnd => {
			clearTimeout(timer);
			return { kind: "failed", code: -1, output: tail() };
		},
	);
	return {
		stop: () => {
			if (stopped) return;
			stopped = "stop";
			proc.stop();
		},
		ended,
	};
}

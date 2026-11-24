import type { HarnessName } from "@nightshift/flows";

import type { SetupPlace } from "../domain/setup-place";
import type {
	RunningInstall,
	RunningSignIn,
	SetupFacts,
	SignInSight,
} from "../domain/setup-runs";

/**
 * How the guided setup starts a program: the vendor's installer, or the
 * CLI's sign-in.
 */
export type SetupProcesses = {
	startInstall(input: {
		command: string;
		extraEnv?: Readonly<Record<string, string>>;
		home: string;
		env: Readonly<Record<string, string | undefined>>;
		timeoutMs?: number;
	}): RunningInstall;
	startSignIn(input: {
		program: string;
		setup: SetupFacts;
		home: string;
		env: Readonly<Record<string, string | undefined>>;
		onSight(sight: SignInSight): void;
		timeoutMs?: number;
	}): RunningSignIn;
};

/**
 * Where a program is on this computer, and the PATH the setup fixes.
 */
export type Programs = {
	/** The path of the program, or null when this computer does not have it. */
	where(program: string): string | null;
	/**
	 * The CLI as a setting names it: a name on the PATH, or a path. Null
	 * when this computer does not have it.
	 */
	found(bin: string): string | null;
	/** Puts the vendors' bin folders on PATH when they exist. */
	putBinsOnPath(): boolean;
	/** A path in the home folder (`~/.local/bin/claude`). */
	pathInHome(...parts: string[]): string;
};

/**
 * The harnesses the guided setup knows, as their vendors document them.
 * @filledBy engine/wire
 */
export type AgentCatalog = {
	all(): { harness: HarnessName; label: string; setup: SetupFacts }[];
	of(harness: HarnessName): SetupFacts | null;
	label(harness: HarnessName): string;
	/** The exact sign-in command the person reads (`claude auth login`). */
	signInCommand(bin: string, setup: SetupFacts): string;
};

/**
 * Checks a harness's CLI. The daemon's check notes `agent-checked`.
 * @filledBy engine/wire
 */
export type SignInChecks = {
	check(
		harness: HarnessName,
		bin: string,
	): Promise<{
		signIn: "signed_in" | "signed_out" | "unknown";
		account: string | null;
	}>;
};

/**
 * Ollama on this computer, or the one Night Shift uses elsewhere.
 * @filledBy engine/ollama
 */
export type LocalOllama = {
	status(model: string): Promise<{
		where: string | null;
		from: string;
		installed: boolean;
		answers: boolean;
		hasModel: boolean;
		download: {
			percent: number;
			running: boolean;
			error: string | null;
		} | null;
	}>;
	pull(model: string): void;
	cancelPull(model: string): Promise<void>;
	refresh(): Promise<void>;
};

/**
 * Where Night Shift runs, and the environment a setup uses.
 * @filledBy engine/wire
 */
export type SetupHere = SetupPlace & {
	home: string;
	env: Record<string, string | undefined>;
	installTimeoutMs?: number;
	signInTimeoutMs?: number;
	startTimeoutMs?: number;
};

/**
 * How long a job waits between asks.
 * @filledBy engine/wire
 */
export type Wait = {
	pause(): Promise<void>;
	now(): number;
};

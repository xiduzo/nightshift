import type { HarnessName } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";

import { AGENT_BLOCKED, refuseBlocked, type SetupPlace } from "./setup-place";

/**
 * The programs a guided setup runs, as the setup sees them: an install
 * with a fixed command, or the sign-in of an agent CLI with its own
 * command. What runs comes only from fixed setup data, never from a
 * request. Each runs in the home folder, and a timeout stops it.
 */

/** The guided setup of one harness's CLI, as the vendor documents it (ADR 25). */
export type SetupFacts = {
	/** Who publishes the CLI and its installer: "Anthropic". */
	vendor: string;
	/** The vendor's install script: a fixed https address. */
	installScript: string;
	/** The shell that runs the script. */
	installShell: string;
	/** Variables the installer gets on top of this computer's. */
	installEnv: Readonly<Record<string, string>>;
	/** The folder the installer puts the CLI in, relative to the home folder. */
	binDir: string;
	/** The CLI's own sign-in command, after the program (`auth login`). */
	signIn: readonly string[];
	/** The hosts a sign-in address may point at, and their subdomains. */
	signInHosts: readonly string[];
	/** Plain pipes, or a terminal for a CLI that refuses to sign in without one. */
	signInIo: "pipes" | "terminal";
	/** The program the installer puts in `binDir` (`claude`). */
	program: string;
};

/** The exact text of what an install runs: the vendor's own command. */
export function installCommand(
	setup: Pick<SetupFacts, "installScript" | "installShell">,
): string {
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

/** What a sign-in shows the person so far. */
export type SignInSight = {
	/** The sign-in address the CLI printed, on one of the vendor's hosts. */
	url: string | null;
	/** The CLI asks for the code the browser shows. */
	codeNeeded: boolean;
};

/** How a sign-in ended. `stopped`: a cancel, or a reload of Night Shift. */
export type SignInEnd =
	| { kind: "exited"; code: number }
	| { kind: "timed-out" }
	| { kind: "stopped" };

/** One sign-in that runs. */
export type RunningSignIn = {
	/** Gives the CLI the code the person pasted. */
	sendCode(code: string): void;
	stop(): void;
	ended: Promise<SignInEnd>;
};

/** The setup of `harness`, when it can act now for this request. Refuses otherwise. */
export function allowedSetup(
	here: boolean,
	place: SetupPlace,
	of: (harness: HarnessName) => SetupFacts | null,
	label: (harness: HarnessName) => string,
	harness: HarnessName,
): SetupFacts {
	refuseBlocked(here, place, AGENT_BLOCKED);
	const setup = of(harness);
	if (!setup) {
		throw new Refusal(
			"invalid",
			`Night Shift cannot install ${label(harness)} for you. Install it yourself, then add it.`,
		);
	}
	return setup;
}

export function installFailedProblem(
	kind: "timed-out" | "failed",
	label: string,
): string {
	return kind === "timed-out"
		? `The install of ${label} took too long. Night Shift stopped it. Try again.`
		: `Night Shift could not install ${label}. Try again, or read the details.`;
}

export function installMissingProblem(label: string): string {
	return `${label} installed, but Night Shift cannot find it. Restart Night Shift, then try again.`;
}

export function unforeseenInstallProblem(): string {
	return "Night Shift could not run the install. Try again.";
}

export function unforeseenSignInProblem(): string {
	return "Night Shift could not run the sign-in. Try again.";
}

export function signInMissingProblem(label: string): string {
	return `${label} is not signed in yet. Try again.`;
}

export function signInTimeoutProblem(): string {
	return "The sign-in took too long. Night Shift stopped it. Try again.";
}

export function curlNeededProblem(label: string): string {
	return `Night Shift needs curl to download ${label}. Install curl, then try again.`;
}

export function agentNotInstalledProblem(label: string): string {
	return `${label} is not installed on this computer. Install it first.`;
}

export function codeNotWaitingProblem(label: string): string {
	return `${label} is not waiting for a code. Start the sign-in again.`;
}

export function pasteCodeProblem(): string {
	return "Paste the code the sign-in page shows.";
}

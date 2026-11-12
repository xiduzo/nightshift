import type { HarnessSetupFacts } from "@nightshift/agents/harness-facts";

import { plainText } from "./plain-text";
import type { SetupProcess, SetupSpawn } from "./spawn";

/**
 * The sign-in of an agent CLI with its own command (`claude auth login`,
 * `codex login`). The CLI opens the browser itself. Night Shift reads its
 * output only for two facts: the sign-in address, when its host is the
 * vendor's, and whether the CLI asks for a code. A code the person pastes
 * goes to the CLI's input. The output is read in memory, never stored or
 * logged, and dropped when the sign-in ends.
 */

/** How long a sign-in may take before Night Shift stops it. */
export const SIGN_IN_TIMEOUT_MS = 10 * 60_000;

/** How much output the reader keeps to find an address or a question in. */
const READ_CHARS = 16_000;
/** After the CLI says it signed in, how long it may wait for a key before it is stopped. */
const AFTER_SUCCESS_MS = 5_000;

const ADDRESSES = /https:\/\/[^\s"'<>`]+/g;
const CODE_QUESTION =
	/paste (?:the |your )?code|code here|enter (?:the |your )?(?:authori[sz]ation |verification |one-time |login )?code/i;
const SIGNED_IN =
	/login successful|successfully (?:logged|signed) in|you are (?:now )?(?:logged|signed) in/i;

/** What a sign-in shows the person so far. */
export type SignInSight = {
	/** The sign-in address the CLI printed, on one of the vendor's hosts. */
	url: string | null;
	/** The CLI asks for the code the browser shows. */
	codeNeeded: boolean;
};

/** Whether `hostname` is one of `hosts`, or a subdomain of one. */
function allowedHost(hostname: string, hosts: readonly string[]): boolean {
	return hosts.some(
		(host) => hostname === host || hostname.endsWith(`.${host}`),
	);
}

/**
 * The first https address in `text` on one of `hosts`: no other address,
 * no user name or port. An address at the very end of `text` may go on in
 * the next piece of output, so it counts only once `ended`.
 */
export function signInAddress(
	text: string,
	hosts: readonly string[],
	ended = false,
): string | null {
	for (const match of text.matchAll(ADDRESSES)) {
		if (!ended && match.index + match[0].length >= text.length) continue;
		const candidate = match[0].replace(/[.,;:!?)\]}>'"]+$/, "");
		let url: URL;
		try {
			url = new URL(candidate);
		} catch {
			continue;
		}
		if (url.protocol !== "https:" || url.username || url.password) continue;
		if (url.port !== "" || !allowedHost(url.hostname, hosts)) continue;
		return url.href;
	}
	return null;
}

/** Whether the CLI asks for a code in `text`. */
export function asksForCode(text: string): boolean {
	return CODE_QUESTION.test(text);
}

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

/**
 * Starts the CLI's sign-in in the home folder, with pipes or in a terminal
 * of its own (`setup.signInIo`). `onSight` hears each change of what it
 * shows. Throws when the CLI cannot start.
 */
export function startSignIn(input: {
	/** The CLI as found on this computer. */
	program: string;
	setup: HarnessSetupFacts;
	spawn: SetupSpawn;
	home: string;
	env: Readonly<Record<string, string | undefined>>;
	onSight(sight: SignInSight): void;
	timeoutMs?: number;
}): RunningSignIn {
	const { setup, spawn } = input;
	const enter = setup.signInIo === "terminal" ? "\r" : "\n";
	// The output so far, in memory only.
	let output = "";
	let sight: SignInSight = { url: null, codeNeeded: false };
	let stopped: "timeout" | "stop" | null = null;
	let afterSuccess: Timer | null = null;
	// Set once the CLI started: a spawn may give output before it returns.
	let proc: SetupProcess | null = null;

	const read = (text: string) => {
		output = (output + text).slice(-READ_CHARS);
		const plain = plainText(output);
		const next: SignInSight = {
			url: sight.url ?? signInAddress(plain, setup.signInHosts),
			codeNeeded: sight.codeNeeded || asksForCode(plain),
		};
		if (next.url !== sight.url || next.codeNeeded !== sight.codeNeeded) {
			sight = next;
			input.onSight(sight);
		}
		// Some CLIs wait for a key after they signed in: press it, and stop
		// one that still waits. Its end is read as a normal end.
		if (!afterSuccess && SIGNED_IN.test(plain)) {
			proc?.write(enter);
			afterSuccess = setTimeout(() => proc?.stop(), AFTER_SUCCESS_MS);
		}
	};

	const started = spawn([input.program, ...setup.signIn], {
		cwd: input.home,
		env: { ...input.env, NO_COLOR: "1" },
		io: setup.signInIo,
		input: true,
		onOutput: read,
	});
	proc = started;
	const timer = setTimeout(() => {
		stopped = "timeout";
		started.stop();
	}, input.timeoutMs ?? SIGN_IN_TIMEOUT_MS);
	const end = (): void => {
		clearTimeout(timer);
		if (afterSuccess) clearTimeout(afterSuccess);
		output = "";
	};
	const ended = started.exited.then(
		(code): SignInEnd => {
			end();
			if (stopped === "stop") return { kind: "stopped" };
			if (stopped === "timeout") return { kind: "timed-out" };
			return { kind: "exited", code };
		},
		(): SignInEnd => {
			end();
			return { kind: "exited", code: -1 };
		},
	);
	return {
		sendCode: (code) => {
			// A new question after this one asks for the code again.
			output = "";
			if (sight.codeNeeded) {
				sight = { ...sight, codeNeeded: false };
				input.onSight(sight);
			}
			started.write(`${code}${enter}`);
		},
		stop: () => {
			if (stopped) return;
			stopped = "stop";
			started.stop();
		},
		ended,
	};
}

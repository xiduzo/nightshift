import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	HARNESS_LABELS,
	type HarnessSetupFacts,
	harnessSetup,
	shellQuote,
} from "@nightshift/agents/harness-facts";
import { findProgram } from "@nightshift/agents/types";
import type { HarnessName } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { now } from "@nightshift/time";

import {
	agentProfileOn,
	type ConfigStores,
	HARNESS_BIN,
} from "../device-config";
import { putAgentBinsOnPath } from "./bin-path";
import { installCommand, type RunningInstall, startInstall } from "./install";
import { type RunningSignIn, startSignIn } from "./sign-in";
import { type SetupSpawn, systemSpawn } from "./spawn";

/**
 * The guided setup of an agent CLI on this computer (ADR 25): install it
 * with the vendor's own script, sign it in with the CLI's own command, and
 * add its harness with a profile. Each step runs only when the person asks
 * for it, from this computer, and never in a container. One job per
 * harness runs at a time. Its state stays in memory: a restart of Night
 * Shift ends it, and the person checks again.
 */

/** The state of the setup of one agent. The screen polls it. */
export type AgentSetupJob =
	| { state: "idle" }
	| { state: "installing"; since: number }
	| { state: "installed"; path: string; at: number }
	/** `output`: the end of what the installer printed, for the details. */
	| { state: "install-failed"; problem: string; output: string; at: number }
	/** Night Shift checks whether the CLI is signed in, before or after a sign-in. */
	| { state: "checking"; since: number }
	/** The person finishes in the browser. `url`: the sign-in page, once the CLI printed it. */
	| { state: "signing-in"; url: string | null; since: number }
	/** The CLI asks for the code the browser shows (`sendCode`). */
	| { state: "code-needed"; url: string | null; since: number }
	| { state: "sign-in-failed"; problem: string; at: number }
	/** Signed in, with the harness added and a profile on it. */
	| {
			state: "ready";
			profileId: string;
			profileName: string;
			account: string | null;
			at: number;
	  }
	| { state: "cancelled"; at: number };

/** Why setup cannot act here. */
export type AgentSetupBlock = "elsewhere" | "container" | "platform";

/** One agent the guided setup can install and sign in. */
export type AgentSetupView = {
	harness: HarnessName;
	label: string;
	/** Who publishes the CLI: "Anthropic". */
	vendor: string;
	/** Where the CLI is on this computer now. Null: not found. */
	path: string | null;
	/** The exact command an install runs, and the script it downloads. */
	install: { command: string; source: string };
	/** The exact command a sign-in runs. */
	signIn: { command: string };
	job: AgentSetupJob;
};

export type AgentSetupStatus = {
	/** Setup can act here, for this request. */
	available: boolean;
	reason: AgentSetupBlock | null;
	/** Why not, for the person. Null when it is available. */
	message: string | null;
	agents: AgentSetupView[];
};

/** Where a request comes from: setup acts only for one from this computer. */
export type AgentSetupCaller = { here: boolean };

export type AgentSetup = {
	status(caller: AgentSetupCaller): AgentSetupStatus;
	/** Starts the vendor's installer. The job tells how it goes. */
	install(harness: HarnessName, caller: AgentSetupCaller): AgentSetupView;
	/** Checks the sign-in, and starts the CLI's own sign-in when it is needed. */
	signIn(harness: HarnessName, caller: AgentSetupCaller): AgentSetupView;
	/** Gives the waiting sign-in the code the browser shows. */
	sendCode(
		harness: HarnessName,
		code: string,
		caller: AgentSetupCaller,
	): AgentSetupView;
	/** Stops the install or the sign-in that runs. */
	cancel(harness: HarnessName, caller: AgentSetupCaller): AgentSetupView;
	/** Stops every job: the daemon stops, or reloads. */
	stop(): void;
};

/** What a sign-in check gives: a `CliCheck` of `@nightshift/agents` fits. */
export type SignInCheck = {
	signIn: "signed_in" | "signed_out" | "unknown";
	account: string | null;
};

export type AgentSetupDeps = {
	stores: Pick<
		ConfigStores,
		"settings" | "profiles" | "connections" | "cliTools"
	>;
	/** Checks a harness's CLI. The daemon's check notes `agent-checked`. */
	check(harness: HarnessName, bin: string): Promise<SignInCheck>;
	/** Night Shift runs in a container: an install would not last. */
	container: boolean;
	platform?: NodeJS.Platform;
	home?: string;
	/** The environment the programs get, and whose PATH the setup fixes. */
	env?: Record<string, string | undefined>;
	/** Where a program is on this computer, or null. */
	which?: (program: string) => string | null;
	spawn?: SetupSpawn;
	installTimeoutMs?: number;
	signInTimeoutMs?: number;
};

/** The systems whose vendors' installers the setup runs (Q24: no Windows). */
const PLATFORMS: readonly NodeJS.Platform[] = ["darwin", "linux"];

const BLOCKED: Record<AgentSetupBlock, string> = {
	elsewhere: "Open Night Shift on that computer to set up an agent there.",
	container:
		"Night Shift runs in a container here, so an install would not last. Add the agent to its image.",
	platform: "Night Shift can set up an agent on macOS and Linux only.",
};

const RUNNING = new Set<AgentSetupJob["state"]>([
	"installing",
	"checking",
	"signing-in",
	"code-needed",
]);

/** The longest code a person can paste. */
const MAX_CODE = 2_048;

/** The harnesses the guided setup knows, in the order the pickers show them. */
function setUpHarnesses(): {
	harness: HarnessName;
	setup: HarnessSetupFacts;
}[] {
	return (Object.keys(HARNESS_BIN) as HarnessName[]).flatMap((harness) => {
		const setup = harnessSetup(harness);
		return setup ? [{ harness, setup }] : [];
	});
}

export function createAgentSetup(deps: AgentSetupDeps): AgentSetup {
	const env = deps.env ?? process.env;
	const home = deps.home ?? (env.HOME || homedir());
	const which = deps.which ?? findProgram;
	const spawn = deps.spawn ?? systemSpawn;
	const platform = deps.platform ?? process.platform;
	const { stores } = deps;

	const jobs = new Map<HarnessName, AgentSetupJob>();
	/** What runs now, per harness. `token` tells a job's late answer from the next job's. */
	const running = new Map<
		HarnessName,
		{ token: number; install?: RunningInstall; signIn?: RunningSignIn }
	>();
	let tokens = 0;

	const jobOf = (harness: HarnessName): AgentSetupJob =>
		jobs.get(harness) ?? { state: "idle" };

	/** The CLI as the harness's setting names it: a name on the PATH, or a path. */
	const binOf = (harness: HarnessName): string =>
		String(stores.settings.current()[HARNESS_BIN[harness]]);

	const found = (bin: string): string | null => {
		if (!bin.includes("/")) return which(bin);
		const path = bin.startsWith("~/") ? join(home, bin.slice(2)) : bin;
		return existsSync(path) ? path : null;
	};

	const view = (
		harness: HarnessName,
		setup: HarnessSetupFacts,
	): AgentSetupView => {
		const bin = binOf(harness);
		return {
			harness,
			label: HARNESS_LABELS[harness],
			vendor: setup.vendor,
			path: found(bin),
			install: { command: installCommand(setup), source: setup.installScript },
			signIn: { command: [shellQuote(bin), ...setup.signIn].join(" ") },
			job: jobOf(harness),
		};
	};

	const block = (caller: AgentSetupCaller): AgentSetupBlock | null => {
		if (!caller.here) return "elsewhere";
		if (deps.container) return "container";
		if (!PLATFORMS.includes(platform)) return "platform";
		return null;
	};

	/** The setup of `harness`, when it can act now for `caller`. Refuses otherwise. */
	const allowed = (
		harness: HarnessName,
		caller: AgentSetupCaller,
	): HarnessSetupFacts => {
		const blocked = block(caller);
		if (blocked) throw new Refusal("forbidden", BLOCKED[blocked]);
		const setup = harnessSetup(harness);
		if (!setup) {
			throw new Refusal(
				"invalid",
				`Night Shift cannot install ${HARNESS_LABELS[harness]} for you. Install it yourself, then add it.`,
			);
		}
		return setup;
	};

	const refuseBusy = (harness: HarnessName): void => {
		if (RUNNING.has(jobOf(harness).state)) {
			throw new Refusal(
				"conflict",
				`Night Shift is setting up ${HARNESS_LABELS[harness]} already. Wait for it, or cancel it.`,
			);
		}
	};

	/** Starts a job: its token, and a way to tell whether it is still the current one. */
	const begin = (harness: HarnessName) => {
		const token = ++tokens;
		running.set(harness, { token });
		return {
			current: () => running.get(harness)?.token === token,
			set: (job: AgentSetupJob) => {
				if (running.get(harness)?.token === token) jobs.set(harness, job);
			},
			end: (job: AgentSetupJob) => {
				if (running.get(harness)?.token !== token) return;
				running.delete(harness);
				jobs.set(harness, job);
			},
			hold: (handle: { install?: RunningInstall; signIn?: RunningSignIn }) => {
				if (running.get(harness)?.token === token) {
					running.set(harness, { token, ...handle });
				}
			},
		};
	};

	const label = (harness: HarnessName) => HARNESS_LABELS[harness];

	async function finishInstall(
		harness: HarnessName,
		setup: HarnessSetupFacts,
		run: RunningInstall,
		job: ReturnType<typeof begin>,
	): Promise<void> {
		const end = await run.ended;
		if (end.kind === "stopped") return;
		if (end.kind !== "done") {
			job.end({
				state: "install-failed",
				problem:
					end.kind === "timed-out"
						? `The install of ${label(harness)} took too long. Night Shift stopped it. Try again.`
						: `Night Shift could not install ${label(harness)}. Try again, or read the details.`,
				output: end.output,
				at: now(),
			});
			return;
		}
		putAgentBinsOnPath(env, home);
		const installed = join(home, setup.binDir, setup.program);
		const path =
			found(binOf(harness)) ?? (existsSync(installed) ? installed : null);
		job.end(
			path
				? { state: "installed", path, at: now() }
				: {
						state: "install-failed",
						problem: `${label(harness)} installed, but Night Shift cannot find it. Restart Night Shift, then try again.`,
						output: end.output,
						at: now(),
					},
		);
	}

	/** Ends a sign-in: the harness and a profile on it when the CLI is signed in. */
	async function ready(
		harness: HarnessName,
		bin: string,
		check: SignInCheck,
		job: ReturnType<typeof begin>,
	): Promise<void> {
		const profile = await agentProfileOn(stores, harness, bin);
		job.end({
			state: "ready",
			profileId: profile.id,
			profileName: profile.name,
			account: check.account,
			at: now(),
		});
	}

	async function runSignIn(
		harness: HarnessName,
		setup: HarnessSetupFacts,
		program: string,
		bin: string,
		job: ReturnType<typeof begin>,
	): Promise<void> {
		// Signed in already: nothing to open in the browser.
		const before = await deps.check(harness, bin);
		if (!job.current()) return;
		if (before.signIn === "signed_in") {
			await ready(harness, bin, before, job);
			return;
		}
		const since = now();
		job.set({ state: "signing-in", url: null, since });
		const run = startSignIn({
			program,
			setup,
			spawn,
			home,
			env,
			timeoutMs: deps.signInTimeoutMs,
			onSight: (sight) =>
				job.set({
					state: sight.codeNeeded ? "code-needed" : "signing-in",
					url: sight.url,
					since,
				}),
		});
		job.hold({ signIn: run });
		const end = await run.ended;
		if (end.kind === "stopped" || !job.current()) return;
		if (end.kind === "timed-out") {
			job.end({
				state: "sign-in-failed",
				problem:
					"The sign-in took too long. Night Shift stopped it. Try again.",
				at: now(),
			});
			return;
		}
		job.set({ state: "checking", since: now() });
		const after = await deps.check(harness, bin);
		if (!job.current()) return;
		if (after.signIn === "signed_in") {
			await ready(harness, bin, after, job);
			return;
		}
		job.end({
			state: "sign-in-failed",
			problem: `${label(harness)} is not signed in yet. Try again.`,
			at: now(),
		});
	}

	/** A job that failed in an unforeseen way: plain words, the error in the log. */
	const failed =
		(job: ReturnType<typeof begin>, kind: "install" | "sign-in") =>
		(error: unknown) => {
			console.error(`[agent-setup] the ${kind} failed:`, error);
			job.end(
				kind === "install"
					? {
							state: "install-failed",
							problem: "Night Shift could not run the install. Try again.",
							output: "",
							at: now(),
						}
					: {
							state: "sign-in-failed",
							problem: "Night Shift could not run the sign-in. Try again.",
							at: now(),
						},
			);
		};

	return {
		status(caller) {
			const reason = block(caller);
			return {
				available: reason === null,
				reason,
				message: reason ? BLOCKED[reason] : null,
				agents: setUpHarnesses().map(({ harness, setup }) =>
					view(harness, setup),
				),
			};
		},

		install(harness, caller) {
			const setup = allowed(harness, caller);
			refuseBusy(harness);
			if (which("curl") === null) {
				throw new Refusal(
					"conflict",
					`Night Shift needs curl to download ${label(harness)}. Install curl, then try again.`,
				);
			}
			const job = begin(harness);
			job.set({ state: "installing", since: now() });
			try {
				const run = startInstall({
					command: installCommand(setup),
					extraEnv: setup.installEnv,
					spawn,
					home,
					env,
					timeoutMs: deps.installTimeoutMs,
				});
				job.hold({ install: run });
				finishInstall(harness, setup, run, job).catch(failed(job, "install"));
			} catch (error) {
				failed(job, "install")(error);
			}
			return view(harness, setup);
		},

		signIn(harness, caller) {
			const setup = allowed(harness, caller);
			refuseBusy(harness);
			const bin = binOf(harness);
			const program = found(bin);
			if (!program) {
				throw new Refusal(
					"conflict",
					`${label(harness)} is not installed on this computer. Install it first.`,
				);
			}
			const job = begin(harness);
			job.set({ state: "checking", since: now() });
			runSignIn(harness, setup, program, bin, job).catch(
				failed(job, "sign-in"),
			);
			return view(harness, setup);
		},

		sendCode(harness, code, caller) {
			const setup = allowed(harness, caller);
			const state = jobOf(harness).state;
			const signIn = running.get(harness)?.signIn;
			if (!signIn || (state !== "code-needed" && state !== "signing-in")) {
				throw new Refusal(
					"conflict",
					`${label(harness)} is not waiting for a code. Start the sign-in again.`,
				);
			}
			// One line, as pasted: no line break reaches the CLI before its end.
			const line = code.replace(/[\r\n]+/g, "").trim();
			if (line.length === 0 || line.length > MAX_CODE) {
				throw new Refusal("invalid", "Paste the code the sign-in page shows.");
			}
			signIn.sendCode(line);
			return view(harness, setup);
		},

		cancel(harness, caller) {
			const setup = allowed(harness, caller);
			const current = running.get(harness);
			if (current) {
				running.delete(harness);
				current.install?.stop();
				current.signIn?.stop();
				jobs.set(harness, { state: "cancelled", at: now() });
			}
			return view(harness, setup);
		},

		stop() {
			for (const [harness, current] of running) {
				current.install?.stop();
				current.signIn?.stop();
				jobs.set(harness, { state: "cancelled", at: now() });
			}
			running.clear();
		},
	};
}

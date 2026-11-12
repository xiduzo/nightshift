import { homedir } from "node:os";
import { findProgram } from "@nightshift/agents/types";
import {
	type DeciderName,
	isAgentProfile,
	type ModelProfileSettings,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { now } from "@nightshift/time";

import {
	type ConfigStores,
	effectiveDecider,
	type ProfileView,
	saveProfile,
} from "../device-config";
import type { OllamaService, OllamaStatus } from "../ollama";
import type { AgentSetupBlock, AgentSetupCaller } from "./agent-setup";
import { type RunningInstall, startInstall } from "./install";
import { type SetupSpawn, systemSpawn } from "./spawn";

/**
 * The guided setup of a decider on this computer (Q22): the small model a
 * Decision node asks when a rule cannot choose. Two choices:
 *
 * - Local: Ollama on this computer, with no account. Night Shift starts
 *   Ollama when it does not answer, downloads the small model after the
 *   person saw its size, and makes the Model Profile `local`. On a Mac with
 *   Homebrew it installs Ollama first, after the person confirms. Elsewhere
 *   the person downloads Ollama from its page and checks again.
 * - TypeSafe Jev: the person pastes a key. Night Shift saves it as a secret
 *   of this computer and makes the Model Profile `jev`. The key never
 *   reaches a log or a reply.
 *
 * Both make the decider the one new Decision nodes start on. Only from this
 * computer, and never in a container: its image has Ollama already. One
 * job runs at a time. Its state stays in memory: a restart of Night Shift
 * ends it.
 */

/** The state of the setup of a decider. The screen polls it. */
export type DeciderSetupJob =
	| { state: "idle" }
	/** Homebrew installs Ollama. */
	| { state: "installing"; since: number }
	/** `output`: the end of what Homebrew printed, for the details. */
	| { state: "install-failed"; problem: string; output: string; at: number }
	/** Night Shift waits for Ollama to answer, and starts it when it does not. */
	| { state: "starting"; since: number }
	/** The model downloads. `percent`: from 0 to 100. */
	| { state: "downloading"; percent: number; since: number }
	| { state: "failed"; problem: string; at: number }
	/** New Decision nodes start on `decider`, with the Model Profile it made. */
	| {
			state: "ready";
			decider: DeciderName;
			profileId: string;
			profileName: string;
			at: number;
	  }
	| { state: "cancelled"; at: number };

/** How Ollama gets on this computer when it is not here. */
export type OllamaInstall =
	/** Homebrew installs it, after the person confirms. `command`: the exact text that runs. */
	| { kind: "brew"; command: string }
	/** The person downloads it from Ollama's page, then checks again. */
	| { kind: "download"; url: string };

export type DeciderSetupStatus = {
	/** The setup can act here, for this request. */
	available: boolean;
	reason: AgentSetupBlock | null;
	/** Why not, for the person. Null when it is available. */
	message: string | null;
	/** The decider new Decision nodes start on now. `chosen`: the person saved it. */
	current: { decider: DeciderName; chosen: boolean };
	/** Ollama, and the model a local decider downloads. */
	local: {
		model: string;
		/** About how big the download of the model is, in bytes. */
		bytes: number;
		/** Null: Ollama on this computer. Else the host name of the Ollama Night Shift uses. */
		where: string | null;
		/** An `ollama` program is on this computer. */
		installed: boolean;
		answers: boolean;
		hasModel: boolean;
		/**
		 * How Ollama gets on this computer. Null: it is here, Night Shift uses
		 * one elsewhere, or the container's image has it.
		 */
		install: OllamaInstall | null;
	};
	typesafe: {
		/** A TypeSafe key is saved, or set in the environment. */
		keySaved: boolean;
		/** Where the person gets a key. */
		keyPage: string;
	};
	job: DeciderSetupJob;
};

export type DeciderSetup = {
	status(caller: AgentSetupCaller): Promise<DeciderSetupStatus>;
	/** Installs Ollama with Homebrew, then sets up the local decider. */
	installOllama(caller: AgentSetupCaller): Promise<DeciderSetupStatus>;
	/** Starts Ollama when it does not answer, downloads the model, and makes it the decider. */
	useLocal(caller: AgentSetupCaller): Promise<DeciderSetupStatus>;
	/**
	 * Saves the TypeSafe key, and makes TypeSafe Jev the decider. Null keeps
	 * the key that is saved already.
	 */
	useTypesafe(
		key: string | null,
		caller: AgentSetupCaller,
	): Promise<DeciderSetupStatus>;
	/** Stops the install, the start or the download that runs. */
	cancel(caller: AgentSetupCaller): Promise<DeciderSetupStatus>;
	/** Stops the job: the daemon stops, or reloads. */
	stop(): void;
};

export type DeciderSetupDeps = {
	stores: Pick<
		ConfigStores,
		"settings" | "profiles" | "connections" | "cliTools"
	>;
	ollama: Pick<OllamaService, "status" | "pull" | "cancelPull" | "refresh">;
	/** The model a decider on this computer downloads, and about how big it is. */
	localModel: { readonly name: string; readonly bytes: number };
	/** The secret that holds the TypeSafe Jev key. */
	typesafeKey: string;
	/** Night Shift runs in a container: its image has Ollama. */
	container: boolean;
	platform?: NodeJS.Platform;
	home?: string;
	/** The environment of the install. */
	env?: Record<string, string | undefined>;
	/** Where a program is on this computer, or null. */
	which?: (program: string) => string | null;
	spawn?: SetupSpawn;
	installTimeoutMs?: number;
	/** How long Night Shift waits for the Ollama it starts to answer. */
	startTimeoutMs?: number;
	/** How often a job asks Ollama how it goes. */
	pollMs?: number;
};

/** The exact command that installs Ollama on a Mac with Homebrew. */
const BREW_INSTALL = "brew install ollama";

/** Ollama's own download pages, where no install runs here. */
const DOWNLOAD_PAGE: Partial<Record<NodeJS.Platform, string>> = {
	darwin: "https://ollama.com/download/mac",
	linux: "https://ollama.com/download/linux",
};

/** Where a person gets a TypeSafe key. */
const TYPESAFE_KEY_PAGE = "https://typesafe.ai";

/** The names of the Model Profiles the setup makes. */
const LOCAL_PROFILE = "local";
const TYPESAFE_PROFILE = "jev";

/** The longest key a person can paste. */
const MAX_KEY = 1_000;

/** How many asks in a row may find no download and no model before the job gives up. */
const QUIET_ASKS = 10;

const PLATFORMS: readonly NodeJS.Platform[] = ["darwin", "linux"];

const BLOCKED: Record<AgentSetupBlock, string> = {
	elsewhere: "Open Night Shift on that computer to set up a decider there.",
	container:
		"Night Shift runs in a container here. Its image has Ollama already. Choose the decider in Settings.",
	platform: "Night Shift can set up a decider on macOS and Linux only.",
};

const RUNNING = new Set<DeciderSetupJob["state"]>([
	"installing",
	"starting",
	"downloading",
]);

export function createDeciderSetup(deps: DeciderSetupDeps): DeciderSetup {
	const env = deps.env ?? process.env;
	const home = deps.home ?? (env.HOME || homedir());
	const which = deps.which ?? findProgram;
	const spawn = deps.spawn ?? systemSpawn;
	const platform = deps.platform ?? process.platform;
	const pollMs = deps.pollMs ?? 500;
	const startTimeoutMs = deps.startTimeoutMs ?? 60_000;
	const { stores, ollama, localModel } = deps;

	let job: DeciderSetupJob = { state: "idle" };
	/** Counts up with each job and each cancel: a stale job's answer is dropped. */
	let token = 0;
	let install: RunningInstall | null = null;

	const block = (caller: AgentSetupCaller): AgentSetupBlock | null => {
		if (!caller.here) return "elsewhere";
		if (deps.container) return "container";
		if (!PLATFORMS.includes(platform)) return "platform";
		return null;
	};

	const allowed = (caller: AgentSetupCaller): void => {
		const blocked = block(caller);
		if (blocked) throw new Refusal("forbidden", BLOCKED[blocked]);
	};

	const refuseBusy = (): void => {
		if (RUNNING.has(job.state)) {
			throw new Refusal(
				"conflict",
				"Night Shift is setting up a decider already. Wait for it, or cancel it.",
			);
		}
	};

	const keySaved = () =>
		stores.connections.secretSource(deps.typesafeKey) !== "missing";

	const installOf = (o: OllamaStatus): OllamaInstall | null => {
		if (deps.container || o.from !== "local" || o.installed || o.answers) {
			return null;
		}
		if (platform === "darwin" && which("brew") !== null) {
			return { kind: "brew", command: BREW_INSTALL };
		}
		const url = DOWNLOAD_PAGE[platform];
		return url ? { kind: "download", url } : null;
	};

	async function status(caller: AgentSetupCaller): Promise<DeciderSetupStatus> {
		const reason = block(caller);
		const o = await ollama.status(localModel.name);
		const view = stores.settings.view();
		const saved = keySaved();
		return {
			available: reason === null,
			reason,
			message: reason ? BLOCKED[reason] : null,
			current: {
				decider: effectiveDecider(view, saved),
				chosen: view.fields.decisionDecider.source === "saved",
			},
			local: {
				model: localModel.name,
				bytes: localModel.bytes,
				where: o.where,
				installed: o.installed,
				answers: o.answers,
				hasModel: o.hasModel,
				install: installOf(o),
			},
			typesafe: { keySaved: saved, keyPage: TYPESAFE_KEY_PAGE },
			job,
		};
	}

	/** Starts a job: whether it is still the current one, and how it sets its state. */
	const begin = () => {
		const mine = ++token;
		const current = () => token === mine;
		return {
			current,
			set: (next: DeciderSetupJob) => {
				if (current()) job = next;
			},
		};
	};
	type Run = ReturnType<typeof begin>;

	const failed = (problem: string): DeciderSetupJob => ({
		state: "failed",
		problem,
		at: now(),
	});

	const pause = () => new Promise<void>((done) => setTimeout(done, pollMs));

	/**
	 * A Model Profile named `base` that says `settings`: the one of that name
	 * gets them (its description stays), else a new one. A name an Agent
	 * Profile has gets a number.
	 */
	async function modelProfile(
		base: string,
		settings: ModelProfileSettings,
	): Promise<ProfileView> {
		const named = stores.profiles.byName(base);
		if (named && !isAgentProfile(named)) {
			return saveProfile(
				stores,
				{
					name: named.name,
					...(named.description ? { description: named.description } : {}),
					...settings,
				},
				{ id: named.id },
			);
		}
		let name = base;
		for (let n = 2; stores.profiles.byName(name); n++) name = `${base}_${n}`;
		return saveProfile(stores, { name, ...settings });
	}

	/** Ollama answers, has the model, and is the decider of new nodes. */
	async function runLocal(run: Run): Promise<void> {
		const model = localModel.name;
		let o = await ollama.status(model);
		if (!run.current()) return;
		if (!o.answers) {
			if (o.from !== "local") {
				run.set(
					failed(
						o.where
							? `Ollama at ${o.where} does not answer. Check that it runs there, then try again.`
							: "Ollama does not answer. Check that it runs, then try again.",
					),
				);
				return;
			}
			if (!o.installed) {
				run.set(
					failed("Ollama is not on this computer. Install it, then try again."),
				);
				return;
			}
			// Night Shift starts it now, and each time Night Shift starts.
			if (stores.settings.current().ollama !== "on") {
				await stores.settings.save({ ollama: "on" });
			}
			await ollama.refresh();
			const until = now() + startTimeoutMs;
			while (!o.answers) {
				if (now() >= until) {
					run.set(
						failed("Ollama did not start. Start it yourself, then try again."),
					);
					return;
				}
				await pause();
				if (!run.current()) return;
				o = await ollama.status(model);
			}
		}
		if (!o.hasModel) {
			const since = now();
			run.set({ state: "downloading", percent: 0, since });
			ollama.pull(model);
			let quiet = 0;
			while (!o.hasModel) {
				await pause();
				if (!run.current()) return;
				o = await ollama.status(model);
				const download = o.download;
				if (o.hasModel) break;
				if (download?.running) {
					quiet = 0;
					run.set({ state: "downloading", percent: download.percent, since });
					continue;
				}
				if (download?.error || ++quiet >= QUIET_ASKS) {
					run.set(
						failed(
							`The download of ${model} stopped. Check the internet connection, then try again.`,
						),
					);
					return;
				}
			}
		}
		if (!run.current()) return;
		const profile = await modelProfile(LOCAL_PROFILE, {
			decider: "ollama",
			model,
		});
		await stores.settings.save({ decisionDecider: "ollama" });
		run.set({
			state: "ready",
			decider: "ollama",
			profileId: profile.id,
			profileName: profile.name,
			at: now(),
		});
	}

	/** A job that failed in an unforeseen way: plain words, the error in the log. */
	const unforeseen = (run: Run) => (error: unknown) => {
		console.error("[decider-setup] the local decider failed:", error);
		run.set(failed("Night Shift could not set up the decider. Try again."));
	};

	async function finishInstall(
		running: RunningInstall,
		run: Run,
	): Promise<void> {
		const end = await running.ended;
		if (install === running) install = null;
		if (end.kind === "stopped" || !run.current()) return;
		if (end.kind !== "done") {
			run.set({
				state: "install-failed",
				problem:
					end.kind === "timed-out"
						? "The install of Ollama took too long. Night Shift stopped it. Try again."
						: "Night Shift could not install Ollama. Try again, or read the details.",
				output: end.output,
				at: now(),
			});
			return;
		}
		run.set({ state: "starting", since: now() });
		const o = await ollama.status(localModel.name);
		if (!run.current()) return;
		if (!o.installed) {
			run.set({
				state: "install-failed",
				problem:
					"Ollama installed, but Night Shift cannot find it. Restart Night Shift, then try again.",
				output: end.output,
				at: now(),
			});
			return;
		}
		await runLocal(run);
	}

	return {
		status,

		async installOllama(caller) {
			allowed(caller);
			refuseBusy();
			const o = await ollama.status(localModel.name);
			const plan = installOf(o);
			if (plan?.kind !== "brew") {
				throw new Refusal(
					"conflict",
					o.installed || o.answers
						? "Ollama is on this computer already."
						: "Night Shift cannot install Ollama here. Download it from its page, then check again.",
				);
			}
			const run = begin();
			run.set({ state: "installing", since: now() });
			try {
				const running = startInstall({
					command: plan.command,
					spawn,
					home,
					env,
					timeoutMs: deps.installTimeoutMs,
				});
				install = running;
				finishInstall(running, run).catch(unforeseen(run));
			} catch (error) {
				console.error("[decider-setup] the install did not start:", error);
				run.set({
					state: "install-failed",
					problem: "Night Shift could not run the install. Try again.",
					output: "",
					at: now(),
				});
			}
			return status(caller);
		},

		async useLocal(caller) {
			allowed(caller);
			refuseBusy();
			const o = await ollama.status(localModel.name);
			if (o.from === "local" && !o.installed && !o.answers) {
				throw new Refusal(
					"conflict",
					"Ollama is not on this computer. Install it first.",
				);
			}
			const run = begin();
			run.set({ state: "starting", since: now() });
			runLocal(run).catch(unforeseen(run));
			return status(caller);
		},

		async useTypesafe(key, caller) {
			allowed(caller);
			refuseBusy();
			const line = key?.trim() ?? "";
			if (line === "") {
				if (!keySaved()) {
					throw new Refusal("invalid", "Paste the key TypeSafe gave you.");
				}
			} else {
				if (line.length > MAX_KEY || /\s/.test(line)) {
					throw new Refusal("invalid", "Paste the key as TypeSafe shows it.");
				}
				try {
					await stores.connections.setSecret(deps.typesafeKey, line);
				} catch (error) {
					// The key never reaches the log, not even inside an error.
					console.error(
						"[decider-setup] the TypeSafe key was not saved:",
						String(error).replaceAll(line, "[the key]"),
					);
					throw new Refusal(
						"unavailable",
						"Night Shift could not save the key. Try again.",
					);
				}
			}
			const run = begin();
			const profile = await modelProfile(TYPESAFE_PROFILE, {
				decider: "typesafe",
			});
			await stores.settings.save({ decisionDecider: "typesafe" });
			run.set({
				state: "ready",
				decider: "typesafe",
				profileId: profile.id,
				profileName: profile.name,
				at: now(),
			});
			return status(caller);
		},

		async cancel(caller) {
			allowed(caller);
			if (RUNNING.has(job.state)) {
				const downloading = job.state === "downloading";
				token += 1;
				install?.stop();
				install = null;
				job = { state: "cancelled", at: now() };
				if (downloading) await ollama.cancelPull(localModel.name);
			}
			return status(caller);
		},

		stop() {
			token += 1;
			install?.stop();
			install = null;
			if (RUNNING.has(job.state)) job = { state: "cancelled", at: now() };
		},
	};
}

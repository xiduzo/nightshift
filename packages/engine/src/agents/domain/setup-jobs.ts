import type { DeciderName, HarnessName } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";

import type { RunningInstall, RunningSignIn } from "./setup-runs";

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

const AGENT_RUNNING = new Set<AgentSetupJob["state"]>([
	"installing",
	"checking",
	"signing-in",
	"code-needed",
]);

export type AgentRun = {
	current(): boolean;
	set(job: AgentSetupJob): void;
	end(job: AgentSetupJob): void;
	hold(handle: { install?: RunningInstall; signIn?: RunningSignIn }): void;
};

/** Jobs of the guided setup of agent CLIs: one per harness, in memory. */
export type AgentJobs = {
	jobOf(harness: HarnessName): AgentSetupJob;
	busy(harness: HarnessName): boolean;
	begin(harness: HarnessName): AgentRun;
	runningOf(
		harness: HarnessName,
	): { install?: RunningInstall; signIn?: RunningSignIn } | undefined;
	cancel(harness: HarnessName, at: number): void;
	stopAll(at: number): void;
};

export function createAgentJobs(): AgentJobs {
	const jobs = new Map<HarnessName, AgentSetupJob>();
	const running = new Map<
		HarnessName,
		{ token: number; install?: RunningInstall; signIn?: RunningSignIn }
	>();
	let tokens = 0;

	const jobOf = (harness: HarnessName): AgentSetupJob =>
		jobs.get(harness) ?? { state: "idle" };

	return {
		jobOf,
		busy: (harness) => AGENT_RUNNING.has(jobOf(harness).state),
		begin(harness) {
			const token = ++tokens;
			running.set(harness, { token });
			return {
				current: () => running.get(harness)?.token === token,
				set: (job) => {
					if (running.get(harness)?.token === token) jobs.set(harness, job);
				},
				end: (job) => {
					if (running.get(harness)?.token !== token) return;
					running.delete(harness);
					jobs.set(harness, job);
				},
				hold: (handle) => {
					if (running.get(harness)?.token === token) {
						running.set(harness, { token, ...handle });
					}
				},
			};
		},
		runningOf: (harness) => running.get(harness),
		cancel(harness, at) {
			const current = running.get(harness);
			if (!current) return;
			running.delete(harness);
			current.install?.stop();
			current.signIn?.stop();
			jobs.set(harness, { state: "cancelled", at });
		},
		stopAll(at) {
			for (const [harness, current] of running) {
				current.install?.stop();
				current.signIn?.stop();
				jobs.set(harness, { state: "cancelled", at });
			}
			running.clear();
		},
	};
}

export function refuseAgentBusy(busy: boolean, label: string): void {
	if (busy) {
		throw new Refusal(
			"conflict",
			`Night Shift is setting up ${label} already. Wait for it, or cancel it.`,
		);
	}
}

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

const DECIDER_RUNNING = new Set<DeciderSetupJob["state"]>([
	"installing",
	"starting",
	"downloading",
]);

export type DeciderRun = {
	current(): boolean;
	set(next: DeciderSetupJob): void;
};

/** The one job of the guided setup of a decider, in memory. */
export type DeciderJob = {
	read(): DeciderSetupJob;
	busy(): boolean;
	begin(): DeciderRun;
	holdInstall(run: RunningInstall | null): void;
	install(): RunningInstall | null;
	cancel(at: number): boolean;
	stop(at: number): void;
};

export function createDeciderJob(): DeciderJob {
	let job: DeciderSetupJob = { state: "idle" };
	let token = 0;
	let install: RunningInstall | null = null;

	return {
		read: () => job,
		busy: () => DECIDER_RUNNING.has(job.state),
		begin() {
			const mine = ++token;
			const current = () => token === mine;
			return {
				current,
				set: (next) => {
					if (current()) job = next;
				},
			};
		},
		holdInstall: (run) => {
			install = run;
		},
		install: () => install,
		cancel(at) {
			if (!DECIDER_RUNNING.has(job.state)) return false;
			const downloading = job.state === "downloading";
			token += 1;
			install?.stop();
			install = null;
			job = { state: "cancelled", at };
			return downloading;
		},
		stop(at) {
			token += 1;
			install?.stop();
			install = null;
			if (DECIDER_RUNNING.has(job.state)) job = { state: "cancelled", at };
		},
	};
}

export function refuseDeciderBusy(busy: boolean): void {
	if (busy) {
		throw new Refusal(
			"conflict",
			"Night Shift is setting up a decider already. Wait for it, or cancel it.",
		);
	}
}

export function deciderFailed(problem: string, at: number): DeciderSetupJob {
	return { state: "failed", problem, at };
}

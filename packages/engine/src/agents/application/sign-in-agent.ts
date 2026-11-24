import type { HarnessName } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { now } from "@nightshift/time";
import type { ComputerAccess } from "../../access";
import type { Actor } from "../../contract";
import {
	agentProfileOn,
	type CliToolStore,
	type ConnectionStore,
	HARNESS_BIN,
	type ProfileStore,
	type SettingsStore,
} from "../../settings";
import type { AgentSetupView } from "../domain/agent-status";
import { type AgentJobs, refuseAgentBusy } from "../domain/setup-jobs";
import {
	agentNotInstalledProblem,
	allowedSetup,
	signInMissingProblem,
	signInTimeoutProblem,
	unforeseenSignInProblem,
} from "../domain/setup-runs";
import type {
	AgentCatalog,
	Programs,
	SetupHere,
	SetupProcesses,
	SignInChecks,
} from "./ports";
import { readAgentSetup } from "./read-agent-setup";

export type SignInAgentPorts = {
	computerAccess: Pick<ComputerAccess, "openComputer">;
	catalog: AgentCatalog;
	settings: Pick<SettingsStore, "current" | "save">;
	profiles: Pick<ProfileStore, "get" | "byName" | "list" | "save">;
	connections: Pick<ConnectionStore, "get">;
	cliTools: Pick<CliToolStore, "get">;
	programs: Pick<Programs, "found">;
	processes: Pick<SetupProcesses, "startSignIn">;
	checks: SignInChecks;
	here: SetupHere;
	jobs: AgentJobs;
};

/**
 * Checks the sign-in, and starts the CLI's own sign-in when it is needed.
 * Only the owner of this computer may (`computerAccess.openComputer`).
 */
export const signInAgent =
	(ports: SignInAgentPorts) =>
	(
		actor: Actor,
		request: { harness: HarnessName; here: boolean },
	): AgentSetupView => {
		ports.computerAccess.openComputer(actor);
		const setup = allowedSetup(
			request.here,
			ports.here,
			(h) => ports.catalog.of(h),
			(h) => ports.catalog.label(h),
			request.harness,
		);
		const label = ports.catalog.label(request.harness);
		refuseAgentBusy(ports.jobs.busy(request.harness), label);
		const bin = String(ports.settings.current()[HARNESS_BIN[request.harness]]);
		const program = ports.programs.found(bin);
		if (!program) {
			throw new Refusal("conflict", agentNotInstalledProblem(label));
		}
		const job = ports.jobs.begin(request.harness);
		job.set({ state: "checking", since: now() });
		runSignIn(ports, request.harness, setup, program, bin, job).catch(
			(error) => {
				console.error("[agent-setup] the sign-in failed:", error);
				job.end({
					state: "sign-in-failed",
					problem: unforeseenSignInProblem(),
					at: now(),
				});
			},
		);
		return agentOf(ports, actor, request.harness);
	};

async function runSignIn(
	ports: SignInAgentPorts,
	harness: HarnessName,
	setup: NonNullable<ReturnType<AgentCatalog["of"]>>,
	program: string,
	bin: string,
	job: ReturnType<AgentJobs["begin"]>,
): Promise<void> {
	const before = await ports.checks.check(harness, bin);
	if (!job.current()) return;
	if (before.signIn === "signed_in") {
		await ready(ports, harness, bin, before, job);
		return;
	}
	const since = now();
	job.set({ state: "signing-in", url: null, since });
	const run = ports.processes.startSignIn({
		program,
		setup,
		home: ports.here.home,
		env: ports.here.env,
		timeoutMs: ports.here.signInTimeoutMs,
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
			problem: signInTimeoutProblem(),
			at: now(),
		});
		return;
	}
	job.set({ state: "checking", since: now() });
	const after = await ports.checks.check(harness, bin);
	if (!job.current()) return;
	if (after.signIn === "signed_in") {
		await ready(ports, harness, bin, after, job);
		return;
	}
	job.end({
		state: "sign-in-failed",
		problem: signInMissingProblem(ports.catalog.label(harness)),
		at: now(),
	});
}

async function ready(
	ports: SignInAgentPorts,
	harness: HarnessName,
	bin: string,
	check: { account: string | null },
	job: ReturnType<AgentJobs["begin"]>,
): Promise<void> {
	const profile = await agentProfileOn(ports, harness, bin);
	job.end({
		state: "ready",
		profileId: profile.id,
		profileName: profile.name,
		account: check.account,
		at: now(),
	});
}

function agentOf(
	ports: SignInAgentPorts,
	actor: Actor,
	harness: HarnessName,
): AgentSetupView {
	const agent = readAgentSetup(ports)(actor, { here: true }).agents.find(
		(row) => row.harness === harness,
	);
	if (!agent) throw new Error(`No setup for ${harness}.`);
	return agent;
}

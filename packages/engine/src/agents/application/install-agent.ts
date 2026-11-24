import type { HarnessName } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { now } from "@nightshift/time";
import type { Actor } from "../../contract";
import { HARNESS_BIN, type SettingsStore } from "../../settings";
import type { AgentSetupView } from "../domain/agent-status";
import { type AgentJobs, refuseAgentBusy } from "../domain/setup-jobs";
import {
	allowedSetup,
	curlNeededProblem,
	installCommand,
	installFailedProblem,
	installMissingProblem,
	unforeseenInstallProblem,
} from "../domain/setup-runs";
import type {
	AgentCatalog,
	Programs,
	SetupHere,
	SetupProcesses,
} from "./ports";
import { readAgentSetup } from "./read-agent-setup";

export type InstallAgentPorts = {
	catalog: AgentCatalog;
	settings: Pick<SettingsStore, "current">;
	programs: Pick<Programs, "found" | "where" | "putBinsOnPath" | "pathInHome">;
	processes: Pick<SetupProcesses, "startInstall">;
	here: SetupHere;
	jobs: AgentJobs;
};

/** Starts the vendor's installer. The job tells how it goes. */
export const installAgent =
	(ports: InstallAgentPorts) =>
	(
		actor: Actor,
		request: { harness: HarnessName; here: boolean },
	): AgentSetupView => {
		const setup = allowedSetup(
			request.here,
			ports.here,
			(h) => ports.catalog.of(h),
			(h) => ports.catalog.label(h),
			request.harness,
		);
		const label = ports.catalog.label(request.harness);
		refuseAgentBusy(ports.jobs.busy(request.harness), label);
		if (ports.programs.where("curl") === null) {
			throw new Refusal("conflict", curlNeededProblem(label));
		}
		const job = ports.jobs.begin(request.harness);
		job.set({ state: "installing", since: now() });
		try {
			const run = ports.processes.startInstall({
				command: installCommand(setup),
				extraEnv: setup.installEnv,
				home: ports.here.home,
				env: ports.here.env,
				timeoutMs: ports.here.installTimeoutMs,
			});
			job.hold({ install: run });
			finishInstall(ports, request.harness, setup, run, job).catch((error) => {
				console.error("[agent-setup] the install failed:", error);
				job.end({
					state: "install-failed",
					problem: unforeseenInstallProblem(),
					output: "",
					at: now(),
				});
			});
		} catch (error) {
			console.error("[agent-setup] the install failed:", error);
			job.end({
				state: "install-failed",
				problem: unforeseenInstallProblem(),
				output: "",
				at: now(),
			});
		}
		return agentOf(ports, actor, request.harness);
	};

async function finishInstall(
	ports: InstallAgentPorts,
	harness: HarnessName,
	setup: { binDir: string; program: string },
	run: { ended: Promise<{ kind: string; output?: string }> },
	job: ReturnType<AgentJobs["begin"]>,
): Promise<void> {
	const end = await run.ended;
	if (end.kind === "stopped") return;
	const output = typeof end.output === "string" ? end.output : "";
	if (end.kind !== "done") {
		job.end({
			state: "install-failed",
			problem: installFailedProblem(
				end.kind === "timed-out" ? "timed-out" : "failed",
				ports.catalog.label(harness),
			),
			output,
			at: now(),
		});
		return;
	}
	ports.programs.putBinsOnPath();
	const installed = ports.programs.pathInHome(setup.binDir, setup.program);
	const path =
		ports.programs.found(
			String(ports.settings.current()[HARNESS_BIN[harness]]),
		) ?? ports.programs.found(installed);
	job.end(
		path
			? { state: "installed", path, at: now() }
			: {
					state: "install-failed",
					problem: installMissingProblem(ports.catalog.label(harness)),
					output,
					at: now(),
				},
	);
}

function agentOf(
	ports: InstallAgentPorts,
	actor: Actor,
	harness: HarnessName,
): AgentSetupView {
	const agent = readAgentSetup(ports)(actor, { here: true }).agents.find(
		(row) => row.harness === harness,
	);
	if (!agent) throw new Error(`No setup for ${harness}.`);
	return agent;
}

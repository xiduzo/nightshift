import { Refusal } from "@nightshift/refusal";
import { now } from "@nightshift/time";

import type { Actor } from "../../contract";
import {
	ollamaInstallOf,
	saveNamedModelProfile,
	withModelAgents,
} from "../domain/decider-plan";
import type { DeciderSetupStatus } from "../domain/decider-status";
import { runLocalDecider } from "../domain/run-local-decider";
import type { DeciderJob } from "../domain/setup-jobs";
import { refuseDeciderBusy } from "../domain/setup-jobs";
import { DECIDER_BLOCKED, refuseBlocked } from "../domain/setup-place";
import type { SetupProcesses } from "./ports";
import { readDeciderSetup } from "./read-decider-setup";
import type { UseLocalDeciderPorts } from "./use-local-decider";

export type InstallOllamaPorts = UseLocalDeciderPorts & {
	processes: Pick<SetupProcesses, "startInstall">;
};

/** Installs Ollama with Homebrew, then sets up the local decider. */
export const installOllama =
	(ports: InstallOllamaPorts) =>
	async (
		actor: Actor,
		request: { here: boolean },
	): Promise<DeciderSetupStatus> => {
		refuseBlocked(request.here, ports.here, DECIDER_BLOCKED);
		refuseDeciderBusy(ports.job.busy());
		const o = await ports.ollama.status(ports.localModel.name);
		const plan = ollamaInstallOf({
			container: ports.here.container,
			platform: ports.here.platform,
			from: o.from,
			installed: o.installed,
			answers: o.answers,
			hasBrew: ports.programs.where("brew") !== null,
		});
		if (plan?.kind !== "brew") {
			throw new Refusal(
				"conflict",
				o.installed || o.answers
					? "Ollama is on this computer already."
					: "Night Shift cannot install Ollama here. Download it from its page, then check again.",
			);
		}
		const run = ports.job.begin();
		run.set({ state: "installing", since: now() });
		try {
			const running = ports.processes.startInstall({
				command: plan.command,
				home: ports.here.home,
				env: ports.here.env,
				timeoutMs: ports.here.installTimeoutMs,
			});
			ports.job.holdInstall(running);
			finishInstall(ports, running, run).catch((error) => {
				console.error("[decider-setup] the local decider failed:", error);
				run.set({
					state: "failed",
					problem: "Night Shift could not set up the decider. Try again.",
					at: now(),
				});
			});
		} catch (error) {
			console.error("[decider-setup] the install did not start:", error);
			run.set({
				state: "install-failed",
				problem: "Night Shift could not run the install. Try again.",
				output: "",
				at: now(),
			});
		}
		return readDeciderSetup(ports)(actor, request);
	};

async function finishInstall(
	ports: InstallOllamaPorts,
	running: { ended: Promise<{ kind: string; output?: string }> },
	run: ReturnType<DeciderJob["begin"]>,
): Promise<void> {
	const end = await running.ended;
	if (ports.job.install() === running) ports.job.holdInstall(null);
	if (end.kind === "stopped" || !run.current()) return;
	const output = typeof end.output === "string" ? end.output : "";
	if (end.kind !== "done") {
		run.set({
			state: "install-failed",
			problem:
				end.kind === "timed-out"
					? "The install of Ollama took too long. Night Shift stopped it. Try again."
					: "Night Shift could not install Ollama. Try again, or read the details.",
			output,
			at: now(),
		});
		return;
	}
	run.set({ state: "starting", since: now() });
	const o = await ports.ollama.status(ports.localModel.name);
	if (!run.current()) return;
	if (!o.installed) {
		run.set({
			state: "install-failed",
			problem:
				"Ollama installed, but Night Shift cannot find it. Restart Night Shift, then try again.",
			output,
			at: now(),
		});
		return;
	}
	await runLocalDecider(
		{
			model: ports.localModel.name,
			startTimeoutMs: ports.here.startTimeoutMs ?? 60_000,
			status: () => ports.ollama.status(ports.localModel.name),
			ollamaOn: () => ports.config.current().ollama === "on",
			turnOllamaOn: () => ports.config.save({ ollama: "on" }),
			refresh: () => ports.ollama.refresh(),
			pull: (model) => ports.ollama.pull(model),
			pause: () => ports.wait.pause(),
			now: () => ports.wait.now(),
			modelProfile: (base, settings) =>
				saveNamedModelProfile(
					base,
					settings,
					(name) => ports.config.profileByName(name),
					(profile, id) => ports.config.saveProfile(profile, id),
				),
			saveLocal: async (profile) => {
				await ports.config.save({
					decisionDecider: "ollama",
					builtinAgents: withModelAgents(
						ports.config.current().builtinAgents,
						profile.name,
						"ollama",
					),
				});
			},
		},
		run,
	);
}

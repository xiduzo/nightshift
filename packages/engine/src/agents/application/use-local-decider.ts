import type { DeciderName } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { now } from "@nightshift/time";
import type { Actor } from "../../contract";
import {
	type CliToolStore,
	type ConnectionStore,
	type ProfileStore,
	type SettingsStore,
	saveProfile,
} from "../../settings";
import { saveNamedModelProfile, withModelAgents } from "../domain/decider-plan";
import type { DeciderSetupStatus } from "../domain/decider-status";
import { runLocalDecider } from "../domain/run-local-decider";
import { type DeciderJob, refuseDeciderBusy } from "../domain/setup-jobs";
import { DECIDER_BLOCKED, refuseBlocked } from "../domain/setup-place";
import type { LocalOllama, Programs, SetupHere, Wait } from "./ports";
import { readDeciderSetup } from "./read-decider-setup";

export type UseLocalDeciderPorts = {
	settings: Pick<SettingsStore, "view" | "current" | "save">;
	profiles: Pick<ProfileStore, "get" | "byName" | "list" | "save">;
	connections: Pick<ConnectionStore, "get" | "secretSource" | "setSecret">;
	cliTools: Pick<CliToolStore, "get">;
	ollama: LocalOllama;
	programs: Pick<Programs, "where">;
	here: SetupHere;
	wait: Wait;
	job: DeciderJob;
	localModel: { name: string; bytes: number };
	typesafeKey: string;
};

/** Starts Ollama when it does not answer, downloads the model, and makes it the decider. */
export const useLocalDecider =
	(ports: UseLocalDeciderPorts) =>
	async (
		actor: Actor,
		request: { here: boolean },
	): Promise<DeciderSetupStatus> => {
		refuseBlocked(request.here, ports.here, DECIDER_BLOCKED);
		refuseDeciderBusy(ports.job.busy());
		const o = await ports.ollama.status(ports.localModel.name);
		if (o.from === "local" && !o.installed && !o.answers) {
			throw new Refusal(
				"conflict",
				"Ollama is not on this computer. Install it first.",
			);
		}
		const run = ports.job.begin();
		run.set({ state: "starting", since: now() });
		runLocalDeciderJob(ports, run).catch((error) => {
			console.error("[decider-setup] the local decider failed:", error);
			run.set({
				state: "failed",
				problem: "Night Shift could not set up the decider. Try again.",
				at: now(),
			});
		});
		return readDeciderSetup(ports)(actor, request);
	};

async function runLocalDeciderJob(
	ports: UseLocalDeciderPorts,
	run: ReturnType<DeciderJob["begin"]>,
): Promise<void> {
	await runLocalDecider(
		{
			model: ports.localModel.name,
			startTimeoutMs: ports.here.startTimeoutMs ?? 60_000,
			status: () => ports.ollama.status(ports.localModel.name),
			ollamaOn: () => ports.settings.current().ollama === "on",
			turnOllamaOn: async () => {
				await ports.settings.save({ ollama: "on" });
			},
			refresh: () => ports.ollama.refresh(),
			pull: (model) => ports.ollama.pull(model),
			pause: () => ports.wait.pause(),
			now: () => ports.wait.now(),
			modelProfile: (base, settings) =>
				saveNamedModelProfile(
					base,
					settings,
					(name) => ports.profiles.byName(name),
					(profile, id) =>
						saveProfile(ports, profile, id === undefined ? {} : { id }),
				),
			saveLocal: async (profile) => {
				await ports.settings.save({
					decisionDecider: "ollama",
					builtinAgents: withModelAgents(
						ports.settings.current().builtinAgents,
						profile.name,
						"ollama" satisfies DeciderName,
					),
				});
			},
		},
		run,
	);
}

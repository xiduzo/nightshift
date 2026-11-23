import type { Actor } from "../../contract";
import { effectiveDecider } from "../../device-config";
import { ollamaInstallOf, TYPESAFE_KEY_PAGE } from "../domain/decider-plan";
import type { DeciderSetupStatus } from "../domain/decider-status";
import type { DeciderJob } from "../domain/setup-jobs";
import { DECIDER_BLOCKED, setupBlock } from "../domain/setup-place";
import type { DeciderConfig, LocalOllama, Programs, SetupHere } from "./ports";

export type ReadDeciderSetupPorts = {
	config: DeciderConfig;
	ollama: Pick<LocalOllama, "status">;
	programs: Pick<Programs, "where">;
	here: SetupHere;
	job: DeciderJob;
	localModel: { name: string; bytes: number };
	typesafeKey: string;
};

/** Says which decider new Decision nodes start on, and how a setup goes. */
export const readDeciderSetup =
	(ports: ReadDeciderSetupPorts) =>
	async (
		_actor: Actor,
		request: { here: boolean },
	): Promise<DeciderSetupStatus> => {
		const reason = setupBlock(request.here, ports.here);
		const o = await ports.ollama.status(ports.localModel.name);
		const view = ports.config.view();
		const saved = ports.config.secretSource(ports.typesafeKey) !== "missing";
		return {
			available: reason === null,
			reason,
			message: reason ? DECIDER_BLOCKED[reason] : null,
			current: {
				decider: effectiveDecider(
					view as Parameters<typeof effectiveDecider>[0],
					saved,
				),
				chosen: view.fields.decisionDecider.source === "saved",
			},
			local: {
				model: ports.localModel.name,
				bytes: ports.localModel.bytes,
				where: o.where,
				installed: o.installed,
				answers: o.answers,
				hasModel: o.hasModel,
				install: ollamaInstallOf({
					container: ports.here.container,
					platform: ports.here.platform,
					from: o.from,
					installed: o.installed,
					answers: o.answers,
					hasBrew: ports.programs.where("brew") !== null,
				}),
			},
			typesafe: { keySaved: saved, keyPage: TYPESAFE_KEY_PAGE },
			job: ports.job.read(),
		};
	};

import {
	type CliToolStore,
	type ConnectionStore,
	type ProfileStore,
	type SettingsStore,
	saveProfile,
} from "../../settings";
import {
	LOCAL_PROFILE,
	QUIET_ASKS,
	saveNamedModelProfile,
	withModelAgents,
} from "../domain/decider-plan";
import { type DeciderRun, deciderFailed } from "../domain/setup-jobs";
import type { LocalOllama, SetupHere, Wait } from "./ports";

export type RunLocalDeciderPorts = {
	settings: Pick<SettingsStore, "view" | "current" | "save">;
	profiles: Pick<ProfileStore, "get" | "byName" | "list" | "save">;
	connections: Pick<ConnectionStore, "get">;
	cliTools: Pick<CliToolStore, "get">;
	ollama: LocalOllama;
	here: SetupHere;
	wait: Wait;
	localModel: { name: string; bytes: number };
};

/** The job of both local setups: Ollama answers, has the model, and is the decider of new nodes. */
export const runLocalDecider =
	(ports: RunLocalDeciderPorts) =>
	async (run: DeciderRun): Promise<void> => {
		const model = ports.localModel.name;
		const status = () => ports.ollama.status(model);
		let o = await status();
		if (!run.current()) return;
		if (!o.answers) {
			if (o.from !== "local") {
				run.set(
					deciderFailed(
						o.where
							? `Ollama at ${o.where} does not answer. Check that it runs there, then try again.`
							: "Ollama does not answer. Check that it runs, then try again.",
						ports.wait.now(),
					),
				);
				return;
			}
			if (!o.installed) {
				run.set(
					deciderFailed(
						"Ollama is not on this computer. Install it, then try again.",
						ports.wait.now(),
					),
				);
				return;
			}
			if (ports.settings.current().ollama !== "on") {
				await ports.settings.save({ ollama: "on" });
			}
			await ports.ollama.refresh();
			const until = ports.wait.now() + (ports.here.startTimeoutMs ?? 60_000);
			while (!o.answers) {
				if (ports.wait.now() >= until) {
					run.set(
						deciderFailed(
							"Ollama did not start. Start it yourself, then try again.",
							ports.wait.now(),
						),
					);
					return;
				}
				await ports.wait.pause();
				if (!run.current()) return;
				o = await status();
			}
		}
		if (!o.hasModel) {
			const since = ports.wait.now();
			run.set({ state: "downloading", percent: 0, since });
			ports.ollama.pull(model);
			let quiet = 0;
			while (!o.hasModel) {
				await ports.wait.pause();
				if (!run.current()) return;
				o = await status();
				const download = o.download;
				if (o.hasModel) break;
				if (download?.running) {
					quiet = 0;
					run.set({ state: "downloading", percent: download.percent, since });
					continue;
				}
				if (download?.error || ++quiet >= QUIET_ASKS) {
					run.set(
						deciderFailed(
							`The download of ${model} stopped. Check the internet connection, then try again.`,
							ports.wait.now(),
						),
					);
					return;
				}
			}
		}
		if (!run.current()) return;
		const profile = await saveNamedModelProfile(
			LOCAL_PROFILE,
			{ decider: "ollama", model },
			(name) => ports.profiles.byName(name),
			(profile, id) =>
				saveProfile(ports, profile, id === undefined ? {} : { id }),
		);
		await ports.settings.save({
			decisionDecider: "ollama",
			builtinAgents: withModelAgents(
				ports.settings.current().builtinAgents,
				profile.name,
				"ollama",
			),
		});
		run.set({
			state: "ready",
			decider: "ollama",
			profileId: profile.id,
			profileName: profile.name,
			at: ports.wait.now(),
		});
	};

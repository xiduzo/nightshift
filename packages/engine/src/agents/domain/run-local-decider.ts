import type { DeciderName } from "@nightshift/flows";

import { LOCAL_PROFILE, QUIET_ASKS, withModelAgents } from "./decider-plan";
import { type DeciderRun, deciderFailed } from "./setup-jobs";

export type LocalOllamaFacts = {
	from: string;
	where: string | null;
	installed: boolean;
	answers: boolean;
	hasModel: boolean;
	download: { percent: number; running: boolean; error: string | null } | null;
};

export type RunLocalDeciderIo = {
	model: string;
	startTimeoutMs: number;
	status(): Promise<LocalOllamaFacts>;
	ollamaOn(): boolean;
	turnOllamaOn(): Promise<void>;
	refresh(): Promise<void>;
	pull(model: string): void;
	pause(): Promise<void>;
	now(): number;
	saveLocal(profile: { id: string; name: string }): Promise<void>;
	modelProfile(
		base: string,
		settings: { decider: DeciderName; model: string },
	): Promise<{ id: string; name: string }>;
};

/** Ollama answers, has the model, and is the decider of new nodes. */
export async function runLocalDecider(
	io: RunLocalDeciderIo,
	run: DeciderRun,
): Promise<void> {
	const model = io.model;
	let o = await io.status();
	if (!run.current()) return;
	if (!o.answers) {
		if (o.from !== "local") {
			run.set(
				deciderFailed(
					o.where
						? `Ollama at ${o.where} does not answer. Check that it runs there, then try again.`
						: "Ollama does not answer. Check that it runs, then try again.",
					io.now(),
				),
			);
			return;
		}
		if (!o.installed) {
			run.set(
				deciderFailed(
					"Ollama is not on this computer. Install it, then try again.",
					io.now(),
				),
			);
			return;
		}
		if (!io.ollamaOn()) await io.turnOllamaOn();
		await io.refresh();
		const until = io.now() + io.startTimeoutMs;
		while (!o.answers) {
			if (io.now() >= until) {
				run.set(
					deciderFailed(
						"Ollama did not start. Start it yourself, then try again.",
						io.now(),
					),
				);
				return;
			}
			await io.pause();
			if (!run.current()) return;
			o = await io.status();
		}
	}
	if (!o.hasModel) {
		const since = io.now();
		run.set({ state: "downloading", percent: 0, since });
		io.pull(model);
		let quiet = 0;
		while (!o.hasModel) {
			await io.pause();
			if (!run.current()) return;
			o = await io.status();
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
						io.now(),
					),
				);
				return;
			}
		}
	}
	if (!run.current()) return;
	const profile = await io.modelProfile(LOCAL_PROFILE, {
		decider: "ollama",
		model,
	});
	await io.saveLocal(profile);
	run.set({
		state: "ready",
		decider: "ollama",
		profileId: profile.id,
		profileName: profile.name,
		at: io.now(),
	});
}

export { withModelAgents };

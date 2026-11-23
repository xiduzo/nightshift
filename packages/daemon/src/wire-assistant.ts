import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { tanstackDecider } from "@nightshift/agents";
import type { Engine, SpaceEngine } from "@nightshift/engine";
import type { ConfigStores } from "@nightshift/engine/settings";
import {
	createAssistant,
	createLearner,
	recordingAssistant,
} from "./assistant";
import { harnessLookup, type localHarnesses } from "./harnesses";

type AssistantDeps = Parameters<typeof createAssistant>[0];

/**
 * The assistant block of the daemon's composition (`daemon.ts`):
 * suggestions and chats in the flow editor, and the Learner. Nothing is
 * made until a call asks.
 */
export function wireDaemonAssistant(
	deps: Pick<AssistantDeps, "clonePath" | "withoutFolder"> & {
		/** The Space view for the session's Person. */
		space: (at: { spaceId: string; personId: string }) => SpaceEngine;
		/** Keeps what an answer cost. */
		engine: Pick<Engine, "keepAnswerCost">;
		config: ConfigStores;
		harnesses: ReturnType<typeof localHarnesses>;
		decider: ReturnType<typeof tanstackDecider>;
		dataDir: string;
		/** The Person who owns this computer: the Learner acts for them. */
		personId: string;
	},
) {
	const { settings, cliTools, connections, profiles } = deps.config;
	const { decider, dataDir, engine } = deps;
	// Suggestions and chats in the flow editor: on this computer's
	// profiles, read only in the project's Clone. A chat reads the
	// project's flows and runs as the Person sees them in the Space.
	const assistantDeps: AssistantDeps = {
		profiles,
		settings,
		...harnessLookup(deps.harnesses, settings),
		clonePath: deps.clonePath,
		withoutFolder: deps.withoutFolder,
		space: deps.space,
		cliTools,
		connections,
		// The Explainer, the Field writer and the Learner on a model of this computer.
		decide: async (input) =>
			decider.value
				? decider.value(input)
				: {
						kind: "error",
						errorKind: "harness",
						message: "This computer has no model that writes an answer.",
						costUsd: null,
					},
		// The check of the Decider picks an option, as a Decision does.
		decideOption: (input) => decider.decide(input),
		ownFolder: async () => {
			const folder = join(dataDir, "assistant");
			await mkdir(folder, { recursive: true });
			return folder;
		},
	};
	return {
		/** The Learner of the run learnings (ADR 37). Its cost goes to the run's Space. */
		learner: (): ReturnType<typeof createLearner> =>
			createLearner({
				...assistantDeps,
				keep: (cost) => engine.keepAnswerCost(cost),
				personId: deps.personId,
			}),
		/**
		 * The assistant, with one record kept per answer that spent something:
		 * the Spend page shows what Night Shift's own agents cost.
		 */
		withCosts: () =>
			recordingAssistant(createAssistant(assistantDeps), {
				keep: (cost) => engine.keepAnswerCost(cost),
				projectOfRun: async (runId, at) =>
					(await deps.space(at).getRun(runId)).projectId,
			}),
	};
}

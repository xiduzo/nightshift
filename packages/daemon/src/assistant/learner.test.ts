import { describe, expect, test } from "bun:test";
import type { AnswerCost } from "@nightshift/engine";
import type {
	ProfileStore,
	SettingsStore,
} from "@nightshift/engine/device-config";
import type { BuiltinAnswers } from "@nightshift/flows";
import { createLearner, type LearnerDeps } from "./learner";

/**
 * The Learner of this computer: what the person chose for it answers, its
 * cost goes to the run's Space in the name of this computer's owner, and a
 * failure gives no notes.
 */

const settings = (
	builtinAgents: BuiltinAnswers,
): Pick<SettingsStore, "current"> => ({
	current: () =>
		({ assistantProfile: "", builtinAgents }) as ReturnType<
			SettingsStore["current"]
		>,
});

const noProfiles: Pick<ProfileStore, "list"> = { list: () => [] };

function deps(over: Partial<LearnerDeps> = {}) {
	const kept: AnswerCost[] = [];
	const asked: string[] = [];
	const all: LearnerDeps = {
		profiles: noProfiles,
		settings: settings({
			learner: { kind: "model", decider: "ollama", model: "small" },
		}),
		harnessFor: () => undefined,
		installed: () => false,
		decide: async (input) => {
			asked.push(input.prompt);
			return {
				kind: "made",
				data: {
					summary: "Read the Gate.",
					data: { learnings: ["Release only from Monday to Thursday."] },
				},
				costUsd: 0.001,
			};
		},
		keep: async (cost) => {
			kept.push(cost);
		},
		personId: "owner",
		now: () => 1_000,
		...over,
	};
	return { learn: createLearner(all), kept, asked };
}

const input = {
	evidence: "# The run\n\nThe person wrote: never on Fridays.",
	spaceId: "space-1",
	projectId: "p1",
	runId: "r1",
	signal: new AbortController().signal,
};

describe("createLearner", () => {
	test("the model the person chose answers, and its cost goes to the run's Space", async () => {
		const { learn, kept, asked } = deps();
		expect(await learn(input)).toEqual([
			"Release only from Monday to Thursday.",
		]);
		expect(asked[0]).toContain("never on Fridays");
		expect(kept).toEqual([
			{
				at: 1_000,
				agent: "learner",
				entry: null,
				projectId: "p1",
				spaceId: "space-1",
				personId: "owner",
				inputTokens: 0,
				outputTokens: 0,
				costUsd: 0.001,
			},
		]);
	});

	test("with nothing that can answer, no notes and no cost", async () => {
		const { learn, kept } = deps({ settings: settings({}) });
		expect(await learn(input)).toEqual([]);
		expect(kept).toEqual([]);
	});

	test("a model that fails gives no notes", async () => {
		const { learn } = deps({
			decide: async () => ({
				kind: "error",
				errorKind: "network",
				message: "Offline.",
				costUsd: null,
			}),
		});
		expect(await learn(input)).toEqual([]);
	});
});

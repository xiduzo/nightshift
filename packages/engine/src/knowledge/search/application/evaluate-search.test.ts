import { describe, expect, test } from "bun:test";
import type { KnowledgeMeaningStatus } from "../domain/meaning";
import type { KnowledgeHit } from "../domain/ranking";
import { evaluateSearch } from "./evaluate-search";
import type { SearchKnowledge } from "./search-knowledge";

/** The use case evaluateSearch, on a search a test answers. */

const status = (state: KnowledgeMeaningStatus["state"]) => ({
	state,
	model: "fake-model",
	done: 0,
	total: 0,
	where: null,
	percent: null,
});

const found = (...paths: string[]) =>
	paths.map((path) => ({ path }) as KnowledgeHit);

function evaluatePorts(
	state: KnowledgeMeaningStatus["state"],
	answer: (request: SearchKnowledge) => KnowledgeHit[],
) {
	const asked: SearchKnowledge[] = [];
	return {
		asked,
		evaluate: evaluateSearch({
			search: async (request) => {
				asked.push(request);
				return answer(request);
			},
			meaning: async () => status(state),
			now: () => 42,
		}),
	};
}

const QUESTIONS = [
	{ query: "vehicle", answers: ["cars.md"] },
	{ query: "release night", answers: ["deploy.md", "nights.md"] },
];

describe("evaluateSearch", () => {
	test("measures each way to search when meaning is on: recall at 5, ranks and nDCG", async () => {
		const t = evaluatePorts("on", ({ text, mode }) =>
			text === "vehicle"
				? mode === "words"
					? found("a.md")
					: found("cars.md")
				: found("deploy.md", "x.md", "nights.md"),
		);
		const result = await t.evaluate({ projectId: "p1", questions: QUESTIONS });
		expect(result).toMatchObject({
			at: 42,
			questions: 2,
			k: 5,
			rows: [
				{ query: "vehicle", ranks: { words: null, meaning: 1, both: 1 } },
				{ query: "release night", ranks: { words: 1, meaning: 1, both: 1 } },
			],
			advice: "too-few",
		});
		expect(result.modes.words).toMatchObject({
			found: 1,
			recall: 0.5,
			allFound: 1,
		});
		expect(result.modes.both).toMatchObject({ found: 2, recall: 1, mrr: 1 });
		expect(t.asked[0]).toEqual({
			projectId: "p1",
			text: "vehicle",
			limit: 20,
			mode: "words",
		});
	});

	test("measures words only while search by meaning is not on, and says it is unavailable", async () => {
		const t = evaluatePorts("preparing", () => found("cars.md"));
		const result = await t.evaluate({ projectId: "p1", questions: QUESTIONS });
		expect(t.asked.map((r) => r.mode)).toEqual(["words", "words"]);
		expect(result.modes.meaning).toBeNull();
		expect(result.modes.both).toBeNull();
		expect(result.advice).toBe("unavailable");
	});
});

import { describe, expect, test } from "bun:test";
import type { BuiltinCheck, BuiltinStatus } from "@nightshift/flows";
import {
	agentNames,
	allAnswer,
	answeredBy,
	answeredIn,
	checkFix,
	checkRows,
	checkSummary,
} from "./check-state";

const claude = {
	kind: "agent",
	profile: "sonnet",
	harness: "claude-code",
	model: "sonnet",
} as const;
const typesafe = { kind: "model", decider: "typesafe" } as const;

const status = (
	id: BuiltinStatus["id"],
	answers: BuiltinStatus["answers"],
	problem: string | null = null,
): BuiltinStatus => ({ id, chosen: false, answers, problem });

/** A computer with one agent and no choice in Settings. */
const DEFAULT: BuiltinStatus[] = [
	status("builder", claude),
	status("improver", claude),
	status("explainer", claude),
	status("field-writer", claude),
	status("decider", typesafe),
	status("brief-writer", typesafe),
];

const result = (fields: Partial<BuiltinCheck> = {}): BuiltinCheck => ({
	id: "builder",
	ok: true,
	ms: 6_200,
	answers: claude,
	problem: null,
	...fields,
});

describe("what answered", () => {
	const name = () => "Claude Code";

	test("a profile with its model, or the agent with its model", () => {
		expect(answeredBy(claude, name)).toBe("sonnet · sonnet");
		expect(answeredBy({ ...claude, profile: null }, name)).toBe(
			"Claude Code · sonnet",
		);
	});

	test("a model by the name the product uses, with its model or the default", () => {
		expect(answeredBy(typesafe, name)).toBe("TypeSafe Jev · default model");
		expect(
			answeredBy({ kind: "model", decider: "ollama", model: "llama3.2" }, name),
		).toBe("Ollama · llama3.2");
		expect(
			answeredBy({ kind: "model", profile: "fast", decider: "openai" }, name),
		).toBe("fast · default model");
	});

	test("nothing answers: no line", () => {
		expect(answeredBy(null, name)).toBeNull();
	});

	test("how fast, in whole seconds", () => {
		expect(answeredIn(6_200)).toBe("Answered in 6 s");
		expect(answeredIn(1_000)).toBe("Answered in 1 s");
		expect(answeredIn(300)).toBe("Answered in under 1 s");
	});
});

describe("the questions of a check", () => {
	test("agents with the same answer share one question, each model has its own", () => {
		const rows = checkRows(DEFAULT);
		expect(rows.map((row) => row.ids)).toEqual([
			["builder", "improver", "explainer", "field-writer"],
			["decider"],
			["brief-writer"],
		]);
		expect(rows.map((row) => row.ask)).toEqual([
			"builder",
			"decider",
			"brief-writer",
		]);
		expect(rows.every((row) => row.blocked === null)).toBe(true);
	});

	test("another agent or a model for one of them: its own question", () => {
		const rows = checkRows([
			status("builder", claude),
			status("improver", { ...claude, model: "opus" }),
			status("explainer", { kind: "model", decider: "ollama" }),
			status("field-writer", { kind: "model", decider: "ollama" }),
		]);
		expect(rows.map((row) => row.ids)).toEqual([
			["builder"],
			["improver"],
			["explainer", "field-writer"],
		]);
	});

	test("an agent that nothing can answer for gets no question: its row holds the problem", () => {
		const rows = checkRows([
			status("builder", null, "No agent can chat on this computer."),
			status("improver", null, "No agent can chat on this computer."),
			status("explainer", claude),
		]);
		expect(rows.map((row) => row.ids)).toEqual([
			["builder"],
			["improver"],
			["explainer"],
		]);
		expect(rows[0]?.blocked).toEqual({
			id: "builder",
			ok: false,
			ms: 0,
			answers: null,
			problem: "No agent can chat on this computer.",
		});
		expect(rows[2]?.blocked).toBeNull();
	});

	test("the names of a row read as a sentence", () => {
		expect(agentNames(["builder"])).toBe("Builder");
		expect(agentNames(["builder", "improver"])).toBe("Builder and Improver");
		expect(agentNames(["builder", "improver", "field-writer"])).toBe(
			"Builder, Improver and Field writer",
		);
	});
});

describe("the fix of a failed check", () => {
	test("a check that answered offers none", () => {
		expect(checkFix(result())).toBeNull();
	});

	test("an agent that did not answer: the setup of an agent", () => {
		expect(checkFix(result({ ok: false }))).toEqual({ kind: "agent" });
	});

	test("a model the setup can make ready: the setup of a model", () => {
		expect(
			checkFix(result({ id: "decider", ok: false, answers: typesafe })),
		).toEqual({ kind: "model" });
		expect(
			checkFix(
				result({
					id: "explainer",
					ok: false,
					answers: { kind: "model", decider: "ollama", model: "llama3.2" },
				}),
			),
		).toEqual({ kind: "model" });
	});

	test("another model, or a model profile: the agent's page in Settings", () => {
		expect(
			checkFix(
				result({
					id: "brief-writer",
					ok: false,
					answers: { kind: "model", decider: "openrouter" },
				}),
			),
		).toEqual({ kind: "settings", agent: "brief-writer" });
		expect(
			checkFix(
				result({
					id: "decider",
					ok: false,
					answers: { kind: "model", profile: "fast", decider: "ollama" },
				}),
			),
		).toEqual({ kind: "settings", agent: "decider" });
	});

	test("nothing could answer: an agent for the two that need tools, else Settings", () => {
		expect(checkFix(result({ ok: false, answers: null }))).toEqual({
			kind: "agent",
		});
		expect(
			checkFix(result({ id: "explainer", ok: false, answers: null })),
		).toEqual({ kind: "settings", agent: "explainer" });
		expect(
			checkFix(result({ id: "brief-writer", ok: false, answers: null })),
		).toEqual({ kind: "settings", agent: "brief-writer" });
	});
});

describe("how a check went", () => {
	test("not checked until every question has its result", () => {
		expect(checkSummary([])).toEqual({ checked: false, failed: 0, total: 0 });
		const partly = checkSummary([{ ok: true }, null]);
		expect(partly).toEqual({ checked: false, failed: 0, total: 2 });
		expect(allAnswer(partly)).toBe(false);
	});

	test("every agent answers only when none failed", () => {
		expect(allAnswer(checkSummary([{ ok: true }, { ok: true }]))).toBe(true);
		const failed = checkSummary([{ ok: true }, { ok: false }]);
		expect(failed).toEqual({ checked: true, failed: 1, total: 2 });
		expect(allAnswer(failed)).toBe(false);
	});
});

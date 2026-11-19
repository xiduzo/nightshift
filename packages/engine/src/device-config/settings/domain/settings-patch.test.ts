import { expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { FIRST_WAIT_TOO_LONG, planSettingsSave } from "./settings-patch";

const ground = { env: {}, embeddingModel: "embed:1" };

test("the words of a first wait longer than the longest one", () => {
	expect(FIRST_WAIT_TOO_LONG).toBe(
		"The first usage-limit wait cannot be longer than the longest one.",
	);
	let thrown: unknown = null;
	try {
		planSettingsSave({ usageLimitFirstWaitMinutes: 90 }, new Map(), ground);
	} catch (error) {
		thrown = error;
	}
	expect(thrown).toBeInstanceOf(Refusal);
	expect((thrown as Refusal).message).toBe(FIRST_WAIT_TOO_LONG);
});

test("a value saves, null forgets, and a key the patch leaves out stays", () => {
	expect(
		planSettingsSave(
			{ agentModel: "opus", networkGraceMinutes: null },
			new Map([["maxConcurrentRuns", 3]]),
			ground,
		),
	).toEqual({ set: [["agentModel", "opus"]], forget: ["networkGraceMinutes"] });
});

test("a saved usage switch marks the notice seen, after the values", () => {
	expect(planSettingsSave({ usage: true }, new Map(), ground).set).toEqual([
		["usage", true],
		["usageSeen", true],
	]);
});

import { describe, expect, test } from "bun:test";
import {
	nextPhase,
	type PathDone,
	pathDone,
	pathSteps,
	stepLine,
} from "./setup-path";

const done = (fields: Partial<PathDone> = {}): PathDone => ({
	agent: false,
	decider: false,
	check: false,
	project: false,
	...fields,
});

describe("which steps are done", () => {
	const facts = {
		profiles: 0,
		decider: { available: true, current: { chosen: false } },
		checked: false,
		projects: 0,
	};

	test("nothing yet", () => {
		expect(pathDone(facts)).toEqual(done());
		// What did not load counts as open.
		expect(
			pathDone({ ...facts, decider: undefined, projects: undefined }),
		).toEqual(done());
	});

	test("an agent, a chosen model, a check that passed and a project", () => {
		expect(
			pathDone({
				profiles: 1,
				decider: { available: true, current: { chosen: true } },
				checked: true,
				projects: 2,
			}),
		).toEqual({ agent: true, decider: true, check: true, project: true });
	});

	test("a model step that cannot act here does not stop the path", () => {
		expect(
			pathDone({
				...facts,
				decider: { available: false, current: { chosen: false } },
			}).decider,
		).toBe(true);
	});
});

describe("the step line", () => {
	test("four steps in order, with the current one and the done ones", () => {
		expect(
			pathSteps("decider", done({ agent: true })).map((step) => [
				step.label,
				step.state,
			]),
		).toEqual([
			["Agent", "done"],
			["Model", "current"],
			["Check", "todo"],
			["Project", "todo"],
		]);
	});

	test("a step a person goes back to is current and still done", () => {
		const [agent] = pathSteps("agent", done({ agent: true }));
		expect(agent).toMatchObject({ state: "current", done: true });
	});

	test("its words for a screen reader", () => {
		expect(stepLine("agent")).toBe("Step 1 of 4: Agent");
		expect(stepLine("check")).toBe("Step 3 of 4: Check");
	});
});

describe("the next step", () => {
	test("after an agent: the model, then the check, then a project", () => {
		const now = done({ agent: true });
		expect(nextPhase("agent", now)).toBe("decider");
		expect(nextPhase("decider", now)).toBe("check");
		expect(nextPhase("check", now)).toBe("project");
		expect(nextPhase("project", now)).toBeNull();
	});

	test("a step that is done is passed over", () => {
		expect(nextPhase("agent", done({ agent: true, decider: true }))).toBe(
			"check",
		);
		expect(
			nextPhase("check", done({ agent: true, check: true, project: true })),
		).toBeNull();
	});

	test("a skipped step stays open, and the path moves on", () => {
		// Skip on the model step: it is not done, the check comes next.
		const now = done({ agent: true });
		expect(nextPhase("decider", now)).toBe("check");
		expect(pathSteps("check", now)[1]).toMatchObject({
			label: "Model",
			state: "todo",
			done: false,
		});
	});
});

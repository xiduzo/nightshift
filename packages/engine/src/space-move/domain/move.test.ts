import { describe, expect, test } from "bun:test";
import { groupBySpace, STILL_RUNNING } from "./move";

describe("groupBySpace", () => {
	test("groups the Projects by the Space they go to, in the order the plan first names each", () => {
		expect(
			groupBySpace({
				app: { spaceId: "platform", projectId: "app" },
				tools: { spaceId: "studio", projectId: "tools" },
				site: { spaceId: "platform", projectId: "site-there" },
			}),
		).toEqual([
			{ to: "platform", map: { app: "app", site: "site-there" } },
			{ to: "studio", map: { tools: "tools" } },
		]);
	});

	test("no Projects: no Spaces", () => {
		expect(groupBySpace({})).toEqual([]);
	});
});

describe("the words of a move", () => {
	test("a move while a run runs a step", () => {
		expect(STILL_RUNNING).toBe(
			"A run of this project is still running. Stop it to move the project.",
		);
	});
});

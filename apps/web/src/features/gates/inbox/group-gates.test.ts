import { describe, expect, test } from "bun:test";

import { groupByProject } from "./group-gates";

const gate = (runId: string, projectId: string, spaceName: string) => ({
	runId,
	projectId,
	projectName: "app",
	spaceName,
});

describe("the inbox groups", () => {
	test("keep projects of the same name in two Spaces apart, oldest Gate first", () => {
		const groups = groupByProject([
			gate("r1", "p-personal", "Personal"),
			gate("r2", "p-platform", "Platform"),
			gate("r3", "p-personal", "Personal"),
		]);
		expect(
			groups.map(([projectId, list]) => [
				projectId,
				list.map((g) => `${g.spaceName}/${g.runId}`),
			]),
		).toEqual([
			["p-personal", ["Personal/r1", "Personal/r3"]],
			["p-platform", ["Platform/r2"]],
		]);
	});

	test("are empty without Gates", () => {
		expect(groupByProject([])).toEqual([]);
	});
});

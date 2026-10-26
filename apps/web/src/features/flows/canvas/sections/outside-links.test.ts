import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow } from "@nightshift/flows";
import featureFactory from "../../editor/lib/fixtures/feature-factory.json";
import { outsideLinks, placeOutside } from "./outside-links";

/** The feature-factory flow, with Build and Review inside Work. */
const factory = {
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	...featureFactory,
	sections: [
		{ id: "spec", label: "Spec", nodes: ["spec", "clarify", "validate"] },
		{ id: "work", label: "Work", nodes: [], sections: ["build", "review"] },
		{ id: "build", label: "Build", nodes: ["build", "stack", "scope"] },
		{
			id: "review",
			label: "Review",
			color: "blue",
			nodes: ["ux", "ui_design", "security", "code", "verdict"],
		},
	],
} as unknown as Flow;

const inBuild = new Set(["build", "stack", "scope"]);
const links = () => outsideLinks(factory, "build", inBuild, (id) => id);

describe("outsideLinks", () => {
	test("names each outside end as the level around draws it", () => {
		const ends = links().ends.map(({ id, side, label, level }) => ({
			id,
			side,
			label,
			level,
		}));
		expect(ends).toEqual(
			expect.arrayContaining([
				// Spec is a box of the whole flow.
				{
					id: "outside:in:section:spec",
					side: "in",
					label: "Spec",
					level: null,
				},
				// Review is a box inside Work, next to Build.
				{
					id: "outside:in:section:review",
					side: "in",
					label: "Review",
					level: "work",
				},
				{
					id: "outside:out:section:review",
					side: "out",
					label: "Review",
					level: "work",
				},
				// A node in no Section shows as itself.
				{ id: "outside:out:human", side: "out", label: "human", level: null },
			]),
		);
	});

	test("draws one line per inside node and outside end, with every edge of the pair", () => {
		const { groups, ends } = links();
		const keys = groups.map((group) => group.key);
		expect(keys).toContain("outside:in:section:spec->build");
		expect(keys).toContain("build->outside:out:human");
		const toReview = groups.find(
			(group) => group.key === "scope->outside:out:section:review",
		);
		expect(toReview?.edges.map((edge) => edge.id)).toEqual(
			expect.arrayContaining(["scope-frontend-ux", "scope-backend-security"]),
		);
		// An end that leads in has a handle for each node and outcome.
		const spec = ends.find((end) => end.id === "outside:in:section:spec");
		expect(spec?.exits.map((exit) => `${exit.from}.${exit.outcome}`)).toEqual([
			"validate.valid",
		]);
		// No edge inside Build crosses.
		expect(keys.some((key) => key === "build->stack")).toBe(false);
	});
});

describe("placeOutside", () => {
	test("puts ends that lead in on the left and the others on the right, stacked", () => {
		const { ends } = links();
		const size = { width: 176, height: 60 };
		const placed = placeOutside(
			ends,
			{ x: 0, y: 0, width: 1000, height: 400 },
			() => size,
			() => 100,
		);
		const left = ends.filter((end) => end.side === "in");
		const right = ends.filter((end) => end.side === "out");
		for (const end of left) expect(placed.get(end.id)?.x).toBeLessThan(-176);
		for (const end of right)
			expect(placed.get(end.id)?.x).toBeGreaterThan(1000);
		const ys = right
			.map((end) => placed.get(end.id)?.y ?? 0)
			.sort((a, b) => a - b);
		for (let at = 1; at < ys.length; at++)
			expect(ys[at] - ys[at - 1]).toBeGreaterThanOrEqual(size.height);
	});
});

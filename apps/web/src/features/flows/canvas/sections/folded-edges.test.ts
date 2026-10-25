import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow } from "@nightshift/flows";
import featureFactory from "../../editor/lib/fixtures/feature-factory.json";
import { groupEdges, groupSegments, labelText } from "../edge-groups";
import { canvasEdges } from "../outcome-edge";
import { recordRoutes } from "../route-cache";
import { foldEdgeGroups, foldedMembers, sectionEnds } from "./folded-edges";

/** The feature-factory flow with the Sections of the research sketch. */
const factory = {
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	...featureFactory,
	sections: [
		{ id: "intake", label: "Intake", nodes: ["branch", "rest", "design"] },
		{ id: "spec", label: "Spec", nodes: ["spec", "clarify", "validate"] },
		{ id: "build", label: "Build", nodes: ["build", "stack", "scope"] },
		{
			id: "review",
			label: "Review",
			nodes: ["ux", "ui_design", "security", "code", "verdict"],
		},
	],
} as unknown as Flow;

const fold = (...ids: string[]) =>
	foldEdgeGroups(factory, groupEdges(factory), new Set(ids));

const pairs = (groups: ReturnType<typeof fold>) =>
	groups.map((group) => [group.key, group.edges.map((edge) => edge.id)]);

describe("foldEdgeGroups", () => {
	test("without folded Sections the groups stay as they are", () => {
		const groups = groupEdges(factory);
		expect(foldEdgeGroups(factory, groups, new Set())).toBe(groups);
		expect(foldEdgeGroups(factory, groups, new Set(["nope"]))).toBe(groups);
	});

	test("a folded Section is one box: edges in lead to it, edges out leave it, edges inside go", () => {
		const groups = fold("build");
		const keys = groups.map((group) => group.key);
		// Inside: build → stack, stack → scope, stack → build.
		expect(keys).not.toContain("build->stack");
		expect(keys.some((key) => key.startsWith("stack"))).toBe(false);
		expect(
			pairs(groups).filter(([key]) => String(key).includes("section:build")),
		).toEqual([
			["validate->section:build", ["validate-valid-build"]],
			["section:build->human", ["build-blocked-human"]],
			["section:build->ux", ["scope-frontend-ux"]],
			["section:build->security", ["scope-backend-security"]],
			["verdict->section:build", ["verdict-changes-build"]],
			["human->section:build", ["human-revise-build"]],
		]);
	});

	test("edges from one node into a box are one line, in the node's outcome order", () => {
		const groups = fold("review");
		const into = groups.find((group) => group.key === "scope->section:review");
		expect(into?.edges.map((edge) => edge.outcome)).toEqual([
			"frontend",
			"backend",
		]);
		expect(into?.id).toBe("scope-frontend-ux");
	});

	test("exits of a box that lead to one node merge, in the box's handle order", () => {
		// verdict.changes → publish; approver is outside too.
		const groups = fold("review");
		expect(
			pairs(groups).filter(([key]) => String(key).startsWith("section:review")),
		).toEqual([
			["section:review->build", ["verdict-changes-build"]],
			["section:review->publish", ["verdict-changes-publish"]],
			["section:review->approver", ["verdict-pass-approver"]],
		]);
	});

	test("an edge between two folded Sections joins their boxes", () => {
		const groups = fold("build", "review");
		const keys = groups.map((group) => group.key);
		expect(keys).toContain("section:build->section:review");
		expect(keys).toContain("section:review->section:build");
		const across = groups.find(
			(group) => group.key === "section:build->section:review",
		);
		expect(across?.edges.map((edge) => edge.id)).toEqual([
			"scope-frontend-ux",
			"scope-backend-security",
		]);
	});

	test("keeps every edge that crosses a box, and drops only the ones inside", () => {
		const groups = fold("intake", "spec", "build", "review");
		const drawn = groups.flatMap((group) => group.edges.map((e) => e.id));
		const inside = (id: string) => {
			const edge = factory.edges.find((e) => e.id === id);
			const boxOf = foldedMembers(
				factory,
				new Set(["intake", "spec", "build", "review"]),
			);
			return (
				edge !== undefined &&
				boxOf.has(edge.from) &&
				boxOf.get(edge.from) === boxOf.get(edge.to)
			);
		};
		expect(drawn.sort()).toEqual(
			factory.edges
				.map((e) => e.id)
				.filter((id) => !inside(id))
				.sort(),
		);
	});

	test("segments of a box name their node and leave from its exit handle", () => {
		const groups = fold("review");
		const out = groups.find((group) => group.key === "section:review->publish");
		if (!out) throw new Error("no group");
		const segments = groupSegments(factory, out);
		expect(segments).toEqual([
			expect.objectContaining({
				outcome: "changes",
				from: "verdict",
				handle: "verdict:changes",
				onNode: true,
			}),
		]);
		expect(labelText(segments)).toBe("verdict.changes");
	});

	test("the drawn edges join the boxes on the canvas", () => {
		const groups = fold("review");
		const edges = canvasEdges(factory, groups);
		const out = edges.find((edge) => edge.source === "section:review");
		expect(out).toEqual(
			expect.objectContaining({
				source: "section:review",
				sourceHandle: "verdict:changes",
				target: "build",
			}),
		);
		const into = edges.find((edge) => edge.target === "section:review");
		expect(into?.sourceHandle).toBe("frontend");
	});
});

describe("kept routes", () => {
	const route = {
		points: [
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
		],
	};
	const routes = new Map([["verdict->publish", route]]);

	test("a line from a box follows the route its node pair got while folded", () => {
		const folded = new Set(["review"]);
		const endOf = sectionEnds(factory, folded);
		const book = recordRoutes(
			factory.nodes,
			groupEdges(factory),
			routes,
			endOf,
		);
		const out = canvasEdges(factory, fold("review"), {
			routes: book,
			endOf,
		}).find(
			(edge) => edge.source === "section:review" && edge.target === "publish",
		);
		expect(out?.data?.route).toEqual(route);
	});

	test("a route kept while folded does not show once the Section unfolds", () => {
		const endOf = sectionEnds(factory, new Set(["review"]));
		const book = recordRoutes(
			factory.nodes,
			groupEdges(factory),
			routes,
			endOf,
		);
		const open = sectionEnds(factory, new Set());
		const edge = canvasEdges(factory, groupEdges(factory), {
			routes: book,
			endOf: open,
		}).find((e) => e.source === "verdict" && e.target === "publish");
		expect(edge?.data?.route).toBeUndefined();
	});
});

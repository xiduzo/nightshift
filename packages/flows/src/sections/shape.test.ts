import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Flow, flowSchema, migrateFlow } from "../document";
import { canMakeSection, sectionBoundary, sectionOf } from "./shape";

/** The 20-node flow of the canvas research, as a person wrote it. */
const factory = flowSchema.parse(
	migrateFlow(
		JSON.parse(
			readFileSync(
				join(import.meta.dir, "fixtures", "feature-factory.json"),
				"utf8",
			),
		),
	),
);

const command = (id: string) => ({
	id,
	type: "command" as const,
	position: { x: 0, y: 0 },
	command: "true",
});
const edge = (from: string, outcome: string, to: string) => ({
	id: `${from}-${outcome}-${to}`,
	from,
	outcome,
	to,
});

/**
 * a → b → c → d, b fails to e, d loops back to c (max 2), and f stands
 * alone.
 */
const small: Flow = flowSchema.parse({
	version: 6,
	start: "a",
	nodes: ["a", "b", "c", "d", "e", "f"].map(command),
	edges: [
		edge("a", "pass", "b"),
		edge("b", "pass", "c"),
		edge("b", "fail", "e"),
		edge("c", "pass", "d"),
		{ ...edge("d", "fail", "c"), max: 2 },
	],
});

describe("canMakeSection", () => {
	test("a connected part with one entry can be a Section", () => {
		expect(canMakeSection(small, ["b", "c", "d"])).toEqual({
			ok: true,
			entry: "b",
		});
	});

	test("the start is an entry", () => {
		expect(canMakeSection(small, ["a", "b"])).toEqual({ ok: true, entry: "a" });
	});

	test("a loop inside the Section keeps one entry", () => {
		expect(canMakeSection(small, ["b", "c", "d", "e"])).toEqual({
			ok: true,
			entry: "b",
		});
	});

	test("no nodes", () => {
		expect(canMakeSection(small, [])).toEqual({
			ok: false,
			problems: [{ code: "empty" }],
		});
	});

	test("unknown ids are reported and left out of the other checks", () => {
		expect(canMakeSection(small, ["b", "zz"])).toEqual({
			ok: false,
			problems: [{ code: "unknown-nodes", nodes: ["zz"] }],
		});
		expect(canMakeSection(small, ["zz"])).toEqual({
			ok: false,
			problems: [{ code: "unknown-nodes", nodes: ["zz"] }, { code: "empty" }],
		});
	});

	test("nodes that fall apart are not one part", () => {
		expect(canMakeSection(small, ["a", "b", "f"])).toEqual({
			ok: false,
			problems: [{ code: "not-connected", parts: [["a", "b"], ["f"]] }],
		});
	});

	test("a part no edge leads into has no entry", () => {
		expect(canMakeSection(small, ["f"])).toEqual({
			ok: false,
			problems: [{ code: "no-entry" }],
		});
	});

	test("the flow entering at two nodes is two entries", () => {
		expect(canMakeSection(small, ["c", "d"])).toEqual({ ok: true, entry: "c" });
		expect(canMakeSection(small, ["d", "e"])).toEqual({
			ok: false,
			problems: [
				{ code: "not-connected", parts: [["d"], ["e"]] },
				{ code: "several-entries", entries: ["d", "e"] },
			],
		});
	});

	test("nodes another Section holds are taken, except by that Section itself", () => {
		const flow: Flow = {
			...small,
			sections: [{ id: "mid", label: "Middle", nodes: ["c", "d"] }],
		};
		expect(canMakeSection(flow, ["b", "c", "d"])).toEqual({
			ok: false,
			problems: [
				{
					code: "in-other-section",
					nodes: [
						{ node: "c", section: "mid" },
						{ node: "d", section: "mid" },
					],
				},
			],
		});
		expect(canMakeSection(flow, ["b", "c", "d"], { section: "mid" })).toEqual({
			ok: true,
			entry: "b",
		});
	});

	test("feature-factory: the Sections of the research sketch", () => {
		expect(canMakeSection(factory, ["branch", "rest", "design"])).toEqual({
			ok: true,
			entry: "branch",
		});
		expect(canMakeSection(factory, ["spec", "clarify", "validate"])).toEqual({
			ok: true,
			entry: "spec",
		});
		expect(canMakeSection(factory, ["build", "stack", "scope"])).toEqual({
			ok: true,
			entry: "build",
		});
		// Review is entered at ux (frontend) and at security (backend).
		expect(
			canMakeSection(factory, [
				"ux",
				"ui_design",
				"security",
				"code",
				"verdict",
			]),
		).toEqual({
			ok: false,
			problems: [{ code: "several-entries", entries: ["ux", "security"] }],
		});
	});
});

describe("sectionBoundary", () => {
	test("feature-factory Build: the entry, the edges in, and one exit per (node, outcome)", () => {
		const boundary = sectionBoundary(factory, ["build", "stack", "scope"]);
		expect(boundary.entry).toBe("build");
		expect(boundary.entries).toEqual(["build"]);
		expect(boundary.start).toBe(false);
		expect(boundary.incoming.map((e) => e.id)).toEqual([
			"validate-valid-build",
			"verdict-changes-build",
			"human-revise-build",
		]);
		expect(
			boundary.outgoing.map(({ label, edges }) => [
				label,
				edges.map((e) => e.to),
			]),
		).toEqual([
			["build · blocked", ["human"]],
			["scope · frontend", ["ux"]],
			["scope · backend", ["security"]],
		]);
	});

	test("edges that leave on the same outcome share one exit, in the node's outcome order", () => {
		const boundary = sectionBoundary(factory, [
			"ux",
			"ui_design",
			"security",
			"code",
			"verdict",
		]);
		expect(boundary.entry).toBeNull();
		expect(boundary.entries).toEqual(["ux", "security"]);
		expect(boundary.outgoing).toEqual([
			{
				from: "verdict",
				outcome: "changes",
				label: "verdict · changes",
				edges: [
					expect.objectContaining({ id: "verdict-changes-build", max: 2 }),
					expect.objectContaining({ id: "verdict-changes-publish" }),
				],
			},
			{
				from: "verdict",
				outcome: "pass",
				label: "verdict · pass",
				edges: [expect.objectContaining({ id: "verdict-pass-approver" })],
			},
		]);
	});

	test("the start inside, and unknown ids left out", () => {
		const boundary = sectionBoundary(small, ["a", "b", "zz"]);
		expect(boundary).toEqual({
			entry: "a",
			entries: ["a"],
			start: true,
			incoming: [],
			outgoing: [
				expect.objectContaining({ label: "b · pass" }),
				expect.objectContaining({ label: "b · fail" }),
			],
		});
	});
});

describe("sectionOf", () => {
	test("the Section that holds a node", () => {
		const flow: Flow = {
			...small,
			sections: [{ id: "mid", label: "Middle", nodes: ["c", "d"] }],
		};
		expect(sectionOf(flow, "d")?.id).toBe("mid");
		expect(sectionOf(flow, "a")).toBeUndefined();
		expect(sectionOf(small, "a")).toBeUndefined();
	});
});

import { describe, expect, test } from "bun:test";
import { type Flow, flowSchema } from "../../flow";
import type { Schedule } from "../../schedules";
import {
	knowledgeFoldersOf,
	knowledgeSourceOf,
	saveKnowledgeSource,
	withKnowledgeSourceSchedule,
} from "./sources";

/**
 * Knowledge sources: the flows the Knowledge page makes, reads back and
 * schedules. A source is a flow with one Subflow node on a source kit.
 */

const callFlow = (kit: string, inputs: Record<string, string>): Flow =>
	flowSchema.parse({
		version: 7,
		start: "sync",
		nodes: [
			{ id: "sync", type: "call", position: { x: 0, y: 0 }, flow: kit, inputs },
		],
		edges: [],
	});

describe("knowledgeSourceOf", () => {
	test("reads back a flow the page made, and nothing else", () => {
		const saved = saveKnowledgeSource({
			source: { kit: "kit:knowledge/jira", inputs: { keys: "PROJ-1" } },
			flows: {},
		});
		expect(saved.name).toBe("knowledge-jira");
		expect(knowledgeSourceOf(saved.flow)).toEqual({
			kit: "kit:knowledge/jira",
			inputs: { keys: "PROJ-1", folder: "jira" },
		});
		// A template, a kit that is not a source, or more nodes: the editor's.
		expect(
			knowledgeSourceOf(callFlow("kit:knowledge/web", { urls: "{{x}}" })),
		).toBeNull();
		expect(
			knowledgeSourceOf(callFlow("kit:knowledge/review-learnings", {})),
		).toBeNull();
		expect(
			knowledgeSourceOf({
				...saved.flow,
				nodes: [
					...saved.flow.nodes,
					...callFlow("kit:knowledge/web", {}).nodes.map((node) => ({
						...node,
						id: "other",
					})),
				],
			}),
		).toBeNull();
	});
});

describe("saveKnowledgeSource", () => {
	test("names a new source after its kind, and gives it a folder of its own", () => {
		const flows = {
			"knowledge-web-pages": callFlow("kit:knowledge/web", { urls: "a" }),
			drawn: callFlow("kit:knowledge/web", { urls: "b", folder: "web-2" }),
		};
		const saved = saveKnowledgeSource({
			source: { kit: "kit:knowledge/web", inputs: { urls: "c" } },
			flows,
		});
		expect(saved.name).toBe("knowledge-web-pages-2");
		expect(knowledgeSourceOf(saved.flow)?.inputs.folder).toBe("web-3");
		expect(saved.flow.description).toBe(
			"Knowledge: Web pages. Edit it on the Knowledge page.",
		);
	});

	test("refuses a folder another flow fills, one outside the knowledge, and a field the kit does not have", () => {
		const flows = { a: callFlow("kit:knowledge/web", { urls: "a" }) };
		const save = (inputs: Record<string, string>) =>
			saveKnowledgeSource({
				source: { kit: "kit:knowledge/folder", inputs },
				flows,
			});
		expect(() => save({ path: "/x", folder: "web" })).toThrow(
			"Another source fills the folder web.",
		);
		expect(() => save({ path: "/x", folder: "learnings" })).toThrow(
			"Choose a folder inside the knowledge",
		);
		expect(() => save({ path: "/x", folder: "../up" })).toThrow(
			"Choose a folder inside the knowledge",
		);
		expect(() => save({ path: "/x", nope: "1" })).toThrow(
			'This source has no field "nope".',
		);
		expect(() => save({ path: " " })).toThrow("Fill in Folder.");
	});
});

describe("knowledgeFoldersOf", () => {
	test("each knowledge kit's folder: its value, else the kit's default, never a template", () => {
		const flow = flowSchema.parse({
			version: 7,
			start: "a",
			nodes: [
				{
					id: "a",
					type: "call",
					position: { x: 0, y: 0 },
					flow: "kit:knowledge/web",
					inputs: {},
				},
				{
					id: "b",
					type: "call",
					position: { x: 0, y: 0 },
					flow: "kit:knowledge/files",
					inputs: { folder: "docs" },
				},
				{
					id: "c",
					type: "call",
					position: { x: 0, y: 0 },
					flow: "kit:knowledge/jira",
					inputs: { folder: "{{x}}" },
				},
			],
			edges: [],
		});
		expect(knowledgeFoldersOf(flow)).toEqual(["docs", "web"]);
	});
});

describe("withKnowledgeSourceSchedule", () => {
	const webhook: Schedule = {
		id: "hook",
		flow: "src",
		inputs: {},
		// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
		webhook: { secret: "${HOOK}" },
		enabled: true,
	};

	test("adds one, changes it, and removes it, and leaves the other schedules", () => {
		const added = withKnowledgeSourceSchedule([webhook], "src", {
			cron: "0 6 * * *",
			device: "studio",
		});
		expect(added).toEqual([
			webhook,
			{
				id: "src",
				flow: "src",
				inputs: {},
				cron: "0 6 * * *",
				enabled: true,
				device: "studio",
			},
		]);
		const paused = added.map((s) =>
			s.id === "src" ? { ...s, enabled: false, stopAt: "07:00" } : s,
		);
		const changed = withKnowledgeSourceSchedule(paused, "src", {
			cron: "0 7 * * 1-5",
		});
		expect(changed[1]).toEqual({
			id: "src",
			flow: "src",
			inputs: {},
			cron: "0 7 * * 1-5",
			enabled: true,
			stopAt: "07:00",
		});
		expect(withKnowledgeSourceSchedule(changed, "src", null)).toEqual([
			webhook,
		]);
	});
});

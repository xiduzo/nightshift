import { describe, expect, test } from "bun:test";
import { kitFlow, kitList, REVIEW_LEARNINGS_KIT } from "../kits";
import {
	KNOWLEDGE_SOURCE_KINDS,
	knowledgeSourceKind,
	knowledgeSourceKitSchema,
} from "./source-kits";

describe("the list of sources", () => {
	test("every knowledge kit but the review is a source the page offers", () => {
		const kits = kitList()
			.map((kit) => kit.name)
			.filter(
				(name) =>
					name.startsWith("kit:knowledge/") && name !== REVIEW_LEARNINGS_KIT,
			);
		const sources: string[] = KNOWLEDGE_SOURCE_KINDS.map((kind) => kind.kit);
		expect([...sources].sort()).toEqual(kits);
		expect<string[]>(knowledgeSourceKitSchema.options).toEqual(sources);
	});

	test("the page offers them in this order", () => {
		expect(KNOWLEDGE_SOURCE_KINDS.map((kind) => kind.label)).toEqual([
			"Folder on this computer",
			"Project files",
			"Web pages",
			"GitHub wiki",
			"Jira",
			"Confluence",
		]);
	});

	test("every kind names the programs its kit's commands run, of those the readiness check knows", () => {
		for (const kind of KNOWLEDGE_SOURCE_KINDS) {
			const commands = (kitFlow(kind.kit)?.nodes ?? [])
				.flatMap((node) => (node.type === "command" ? [node.command] : []))
				.join("\n");
			const runs = ["curl", "jq"].filter((program) =>
				new RegExp(`(^|[\\s|(])${program}\\s`, "m").test(commands),
			);
			expect([...kind.programs].sort()).toEqual(runs);
		}
	});
});

describe("knowledgeSourceKind", () => {
	test("finds the kind of a source's kit", () => {
		expect(knowledgeSourceKind("kit:knowledge/jira").flowName).toBe(
			"knowledge-jira",
		);
	});

	test("a kit that is not a source has no kind", () => {
		expect(knowledgeSourceKind(REVIEW_LEARNINGS_KIT)).toBeUndefined();
		expect(knowledgeSourceKind("kit:knowledge/nope")).toBeUndefined();
	});
});

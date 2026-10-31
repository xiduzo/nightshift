import { describe, expect, test } from "bun:test";
import { kitFlow } from "../kits";
import {
	KNOWLEDGE_FOLDER_INPUT,
	KNOWLEDGE_SOURCE_KINDS,
	knowledgeSourceBracesProblem,
	knowledgeSourceFields,
} from "./sources";

/**
 * The kinds of source the Knowledge page offers name the inputs of their
 * kits: a kit that renames an input breaks this test, not the page.
 */

describe("KNOWLEDGE_SOURCE_KINDS", () => {
	test("every kind's main and line inputs are inputs of its kit, and every kit has a folder", () => {
		for (const kind of KNOWLEDGE_SOURCE_KINDS) {
			const names = (kitFlow(kind.kit)?.inputs ?? []).map(
				(input) => input.name,
			);
			expect(names).toContain(KNOWLEDGE_FOLDER_INPUT);
			expect(names).toContain(kind.main);
			for (const line of kind.lines) expect(names).toContain(line);
		}
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

	test("a person fills in every input of the kit but its folder", () => {
		const fields = knowledgeSourceFields("kit:knowledge/web").map(
			(input) => input.name,
		);
		expect(fields).toContain("urls");
		expect(fields).not.toContain(KNOWLEDGE_FOLDER_INPUT);
	});
});

describe("knowledgeSourceBracesProblem", () => {
	test("a value with {{ cannot be kept, and the message names its field", () => {
		expect(
			knowledgeSourceBracesProblem({
				kit: "kit:knowledge/web",
				inputs: { urls: "https://example.org/{{page}}" },
			}),
		).toBe("Pages cannot contain {{. Remove it.");
		expect(
			knowledgeSourceBracesProblem({
				kit: "kit:knowledge/web",
				inputs: { urls: "https://example.org/{page}" },
			}),
		).toBeNull();
	});
});

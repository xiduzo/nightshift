import { describe, expect, test } from "bun:test";
import { knowledgeSourceBracesProblem, knowledgeSourceFields } from "./sources";
import { KNOWLEDGE_FOLDER_INPUT } from "./sync-kit";

describe("knowledgeSourceFields", () => {
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

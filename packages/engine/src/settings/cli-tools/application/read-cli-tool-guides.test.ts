import { describe, expect, test } from "bun:test";
import { inMemoryProgramHelp } from "../adapters/out/in-memory-neighbours";
import { inMemorySavedCliTools } from "../adapters/out/in-memory-saved-cli-tools";
import { readCliToolGuides } from "./read-cli-tool-guides";

describe("readCliToolGuides", () => {
	test("each guide has the description and the help of the program the tool runs", async () => {
		const saved = inMemorySavedCliTools([
			[
				"gh-work",
				{
					description: "Work account",
					program: "gh",
					login: { env: { GH_TOKEN: "${WORK}" } },
					git: null,
					updatedAt: 1,
				},
			],
		]);
		const programs = inMemoryProgramHelp({ gh: "gh help", jq: "jq help" });
		const guides = await readCliToolGuides({ saved, programs })({
			names: ["gh-work", "jq"],
		});
		expect(guides).toEqual([
			{
				name: "gh-work",
				program: "gh",
				login: true,
				description: "Work account",
				help: "gh help",
			},
			{ name: "jq", description: null, help: "jq help" },
		]);
		expect(programs.asked).toEqual(["gh", "jq"]);
	});
});

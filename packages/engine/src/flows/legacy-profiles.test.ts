import { describe, expect, test } from "bun:test";
import { parseLegacyProfiles } from "./legacy-profiles";

const builder = {
	harness: "opencode",
	model: "openai/gpt-5.2",
	effort: "high",
	permissionMode: "auto",
	clis: ["gh"],
	connections: ["playwright"],
};

const triage = { decider: "openrouter", model: "~typesafe/jev-latest" };

describe("a project's profiles file from before ADR 3", () => {
	test("no file is no profiles", () => {
		expect(parseLegacyProfiles(null)).toEqual({ profiles: [], issues: [] });
	});

	test("reads both kinds; a bad entry and a repeated name are left out with an error", () => {
		const read = parseLegacyProfiles({
			json: {
				version: 1,
				profiles: [
					{ name: "builder", ...builder },
					{ name: "triage", ...triage, description: "Small calls" },
					{ name: "broken", harness: "claude-code" },
					{ name: "triage", decider: "ollama" },
				],
			},
		});
		expect(read.profiles.map((p) => p.name)).toEqual(["builder", "triage"]);
		expect(read.issues).toEqual([
			{
				severity: "error",
				message:
					'The profile "broken" is not valid. It needs a name, and a harness, a model and a permission mode, or a decider.',
				profile: "broken",
			},
			{
				severity: "error",
				message: 'Two profiles are named "triage". Give each its own name.',
				profile: "triage",
			},
		]);
	});

	test("a file that is not JSON, or has another version, has no profiles", () => {
		expect(parseLegacyProfiles({ jsonError: "Unexpected token" })).toEqual({
			profiles: [],
			issues: [
				{ severity: "error", message: "Not valid JSON: Unexpected token" },
			],
		});
		const read = parseLegacyProfiles({ json: { version: 2, profiles: [] } });
		expect(read.profiles).toEqual([]);
		expect(read.issues[0]?.message).toStartWith("version:");
	});
});

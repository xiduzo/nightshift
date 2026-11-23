import { describe, expect, test } from "bun:test";
import { cliToolsInstruction } from "./cli-tool-guides";

describe("cliToolsInstruction", () => {
	test("no tools give no section", () => {
		expect(cliToolsInstruction([])).toBe("");
	});

	test("a tool of another program says what to type, and quotes the help in a longer fence", () => {
		const text = cliToolsInstruction([
			{
				name: "gh-work",
				program: "gh",
				login: true,
				description: "Work account",
				help: "use ```code```",
			},
		]);
		expect(text).toBe(
			[
				"## CLI tools",
				"",
				"You can run these programs in your shell. Use them instead of guessing at an API. For the details of one command, run it with `--help`.",
				"",
				"### gh-work",
				"",
				"Work account",
				"",
				"`gh-work` runs `gh` with its own login. Type `gh-work` where you would type `gh`.",
				"",
				"`gh-work --help`:",
				"",
				"````text",
				"use ```code```",
				"````",
			].join("\n"),
		);
	});
});

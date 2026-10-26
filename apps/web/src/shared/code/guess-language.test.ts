import { describe, expect, test } from "bun:test";

import { guessLanguage } from "./guess-language";

describe("guessLanguage", () => {
	test("a shebang decides", () => {
		expect(guessLanguage("#!/usr/bin/env python3\nx = 1")).toBe("python");
		expect(guessLanguage("#!/usr/bin/env bun\nconsole.log(1)")).toBe(
			"typescript",
		);
		expect(guessLanguage("#!/bin/sh\nls")).toBe("bash");
	});

	test("JSON with templates is JSON", () => {
		expect(guessLanguage('{"ticket": {{ticket}}, "all": true}')).toBe("json");
		expect(guessLanguage("[1, 2]")).toBe("json");
		expect(guessLanguage("{ not json")).toBeNull();
	});

	test("a prompt with headings and lists is Markdown", () => {
		const prompt =
			"# Plan\n\nRead ticket {{ticket}}.\n\n- Small tasks\n- **One** goal";
		expect(guessLanguage(prompt)).toBe("markdown");
	});

	test("a script is shell", () => {
		const script =
			'set -eo pipefail\njob="$(pwd)/.explore"\nmkdir -p "$job"\ngh pr list | head -n 1';
		expect(guessLanguage(script)).toBe("bash");
		expect(guessLanguage("bun run check")).toBe("bash");
		const commented =
			'# Collects what the charter needs.\n# The focus as a key.\nfocus="{{focus}}"\nkey=$(printf "%s" "$focus" | grep -oE "PZ-[0-9]+")\nif [ -n "$key" ]; then\n  echo "$key"\nfi';
		expect(guessLanguage(commented)).toBe("bash");
	});

	test("TypeScript, Python and YAML", () => {
		expect(
			guessLanguage(
				'import { x } from "y";\nconst total: number = x.length;\nexport function run() {}',
			),
		).toBe("typescript");
		expect(
			guessLanguage("import json\n\ndef run(path):\n    print(path)"),
		).toBe("python");
		expect(guessLanguage("name: build\nsteps:\n  - run: bun test")).toBe(
			"yaml",
		);
	});

	test("plain sentences are nothing in particular", () => {
		expect(guessLanguage("")).toBeNull();
		expect(
			guessLanguage(
				"Write a short summary of the change.\nNote: keep it friendly.",
			),
		).toBeNull();
	});
});

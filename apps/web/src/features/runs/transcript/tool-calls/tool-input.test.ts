import { describe, expect, test } from "bun:test";

import { summarizeToolInput } from "./tool-input";

describe("a tool call's one-line summary", () => {
	const root = "/work/copies/run-1";

	test("shows a path inside the project relative to it", () => {
		expect(
			summarizeToolInput({ file_path: `${root}/src/a.kt`, content: "" }, root),
		).toBe("src/a.kt");
		expect(summarizeToolInput({ filePath: `${root}/README.md` }, root)).toBe(
			"README.md",
		);
	});

	test("keeps a path outside the project, and a command as it is", () => {
		expect(summarizeToolInput({ file_path: "/etc/hosts" }, root)).toBe(
			"/etc/hosts",
		);
		expect(summarizeToolInput({ command: `ls ${root}` }, root)).toBe(
			`ls ${root}`,
		);
	});

	test("names the pattern of a search of the whole project", () => {
		expect(summarizeToolInput({ pattern: "TODO", path: root }, root)).toBe(
			"TODO",
		);
		expect(
			summarizeToolInput({ pattern: "TODO", path: `${root}/src` }, root),
		).toBe("src");
		expect(summarizeToolInput({ path: root }, root)).toBe(".");
	});
});

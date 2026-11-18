import { describe, expect, test } from "bun:test";
import { projectPath } from "./project-path";

const ROOT = "/work/copies/run-1";

describe("projectPath", () => {
	test("shows a path inside the project relative to it", () => {
		expect(projectPath(`${ROOT}/src/a.ts`, ROOT)).toBe("src/a.ts");
		expect(projectPath(`${ROOT}/src/a.ts`, `${ROOT}/`)).toBe("src/a.ts");
	});

	test("is empty for the project's folder itself", () => {
		expect(projectPath(ROOT, ROOT)).toBe("");
		expect(projectPath(`${ROOT}/`, ROOT)).toBe("");
	});

	test("keeps a path outside the project", () => {
		expect(projectPath("/etc/hosts", ROOT)).toBe("/etc/hosts");
		expect(projectPath(`${ROOT}-other/a.ts`, ROOT)).toBe(`${ROOT}-other/a.ts`);
	});

	test("drops a leading ./ and spaces, with or without a root", () => {
		expect(projectPath("./src/a.ts")).toBe("src/a.ts");
		expect(projectPath(" src/a.ts ", ROOT)).toBe("src/a.ts");
	});
});

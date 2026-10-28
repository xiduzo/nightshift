import { describe, expect, test } from "bun:test";
import { flowNameOfFile } from "./flow-file";

describe("the flow name a file suggests", () => {
	test("is the file name without .json, as a flow name", () => {
		expect(flowNameOfFile("build.json")).toBe("build");
		expect(flowNameOfFile("Build Check.JSON")).toBe("build-check");
		expect(flowNameOfFile("--nightly_run (2).json")).toBe("nightly-run-2");
	});

	test("is cut to the longest flow name, without a dash at the end", () => {
		const name = flowNameOfFile(`${"a".repeat(59)} b.json`);
		expect(name).toBe("a".repeat(59));
	});

	test("is a fixed name when the file name holds no letter or digit", () => {
		expect(flowNameOfFile("___.json")).toBe("imported-flow");
		expect(flowNameOfFile(".json")).toBe("imported-flow");
	});
});

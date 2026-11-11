import { describe, expect, test } from "bun:test";
import { dataProblem, schemaProblem } from "./output-schema";

describe("output schemas", () => {
	test("a file shape is a string of the format file", () => {
		const schema = {
			type: "object",
			properties: { report: { type: "string", format: "file" } },
		};
		expect(schemaProblem(schema)).toBeNull();
		expect(dataProblem(schema, { report: "report.md" })).toBeNull();
		expect(dataProblem(schema, { report: 3 })).toBe(
			"data/report must be string",
		);
	});
});

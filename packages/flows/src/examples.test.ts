import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Flow } from "./schema";
import { parseFlow, validateFlow } from "./validate";

/** The example projects of the repo: `examples/<project>/.nightshift/flows/*.json`. */
const examplesDir = join(import.meta.dir, "..", "..", "..", "examples");

const projects = readdirSync(examplesDir, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.sort();

function flowFiles(project: string): string[] {
	const dir = join(examplesDir, project, ".nightshift", "flows");
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => join(dir, name));
}

describe("example flows", () => {
	test("there is at least one example project", () => {
		expect(projects.length).toBeGreaterThan(0);
	});

	for (const project of projects) {
		describe(project, () => {
			const parsed = flowFiles(project).map((path) => {
				const name = path.slice(path.lastIndexOf("/") + 1, -".json".length);
				return { name, ...parseFlow(JSON.parse(readFileSync(path, "utf8"))) };
			});
			const all: Record<string, Flow | null> = Object.fromEntries(
				parsed.map(({ name, flow }) => [name, flow]),
			);

			for (const { name, flow, issues } of parsed) {
				test(`${name}.json parses against the schema`, () => {
					// The schema errors, when there are any.
					expect(flow === null ? issues : []).toEqual([]);
				});

				test(`${name}.json has no validation errors`, () => {
					if (flow === null) throw new Error(`${name}.json does not parse.`);
					const errors = validateFlow(flow, { flows: all }).filter(
						(issue) => issue.severity === "error",
					);
					expect(errors).toEqual([]);
				});
			}
		});
	}
});

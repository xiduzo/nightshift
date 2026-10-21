import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FLOW_VERSION, type Flow } from "../document";
import { parseFlow, validateFlow } from "./flow";

/** The example projects of the repo: `examples/<project>/.nightshift/flows/*.json`. */
const examplesDir = join(import.meta.dir, "..", "..", "..", "..", "examples");

const projects = readdirSync(examplesDir, { withFileTypes: true })
	.filter(
		(entry) =>
			entry.isDirectory() &&
			existsSync(join(examplesDir, entry.name, ".nightshift", "flows")),
	)
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
	test("the example projects are there", () => {
		expect(projects).toContain("rpgdotexe");
		expect(projects).toContain("starters");
	});

	for (const project of projects) {
		describe(project, () => {
			const parsed = flowFiles(project).map((path) => {
				const name = path.slice(path.lastIndexOf("/") + 1, -".json".length);
				const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
				return { name, raw, ...parseFlow(raw) };
			});
			const all: Record<string, Flow | null> = Object.fromEntries(
				parsed.map(({ name, flow }) => [name, flow]),
			);

			for (const { name, raw, flow, issues } of parsed) {
				test(`${name}.json parses against the schema`, () => {
					// The schema errors, when there are any.
					expect(flow === null ? issues : []).toEqual([]);
				});

				test(`${name}.json is written as version ${FLOW_VERSION}`, () => {
					// parseFlow migrates older files, so read the file's own version.
					expect((raw as { version?: unknown }).version).toBe(FLOW_VERSION);
				});

				test(`${name}.json has no validation errors`, () => {
					if (flow === null) throw new Error(`${name}.json does not parse.`);
					// Warnings (an outcome without an edge, for one) are allowed.
					const errors = validateFlow(flow, { flows: all, name }).filter(
						(issue) => issue.severity === "error",
					);
					expect(errors).toEqual([]);
				});
			}
		});
	}
});

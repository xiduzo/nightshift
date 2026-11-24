import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FLOW_VERSION, type Flow, flowSchema } from "../flow";
import { validateFlow } from "./flow";
import { canonicalFlowJson } from "./sources";

/** The example projects of the repo: `examples/<project>/flows/*.json`, files to import. */
const examplesDir = join(import.meta.dir, "..", "..", "..", "..", "examples");

/** The flow folder of each project: the examples, and the starters Night Shift ships. */
const folders: Record<string, string> = {
	...Object.fromEntries(
		readdirSync(examplesDir, { withFileTypes: true })
			.filter(
				(entry) =>
					entry.isDirectory() &&
					existsSync(join(examplesDir, entry.name, "flows")),
			)
			.map((entry) => [entry.name, join(examplesDir, entry.name, "flows")]),
	),
	starters: join(import.meta.dir, "..", "starters", "flows"),
};
const projects = Object.keys(folders).sort();

function flowFiles(project: string): string[] {
	const dir = folders[project] as string;
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
				const read = flowSchema.safeParse(raw);
				return {
					name,
					flow: read.data ?? null,
					issues: read.error?.issues ?? [],
				};
			});
			const all: Record<string, Flow | null> = Object.fromEntries(
				parsed.map(({ name, flow }) => [name, flow]),
			);

			for (const { name, flow, issues } of parsed) {
				test(`${name}.json parses against the schema`, () => {
					// The schema errors, when there are any.
					expect(issues).toEqual([]);
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

describe("flow files of the repository", () => {
	const root = join(import.meta.dir, "..", "..", "..", "..");
	const isFlowFile = (json: unknown) =>
		typeof json === "object" &&
		json !== null &&
		"version" in json &&
		"nodes" in json &&
		"edges" in json;
	const files = [
		"{community,docs,examples}/**/*.json",
		"{apps,packages}/*/{src,test}/**/*.json",
	]
		.flatMap((pattern) => [...new Bun.Glob(pattern).scanSync(root)])
		.sort()
		.map((path) => ({
			path,
			json: JSON.parse(readFileSync(join(root, path), "utf8")) as unknown,
		}))
		.filter(({ json }) => isFlowFile(json));

	test("the starters, the community flows and the examples are among them", () => {
		const paths = files.map(({ path }) => path).join("\n");
		expect(paths).toContain("community/review-pr/flow.json");
		expect(paths).toContain("examples/rpgdotexe/flows/night.json");
		expect(paths).toContain("packages/flows/src/starters/flows/per-file.json");
	});

	for (const { path, json } of files) {
		test(`${path} is in the current format, as a save writes it`, () => {
			expect((json as { version: unknown }).version).toBe(FLOW_VERSION);
			// A field that the format does not have does not survive the read.
			expect(json).toEqual(
				JSON.parse(canonicalFlowJson(flowSchema.parse(json))),
			);
		});
	}
});

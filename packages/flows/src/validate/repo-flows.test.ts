import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Flow, FlowMigration } from "../document";
import { isProfileRef } from "../nodes";
import { parseProfilesSource, profileOf } from "../profiles";
import { schedulesFileSchema, validateSchedules } from "../schedules";
import { parseFlow, validateFlow } from "./flow";

/**
 * Night Shift's own flows: `.nightshift/` at the root of this repo, where
 * Night Shift works on itself. They use the newer pieces (a fan-out and a
 * Join, End nodes, kits, a Gate deadline, a kept variable, webhooks and
 * the project's profiles), so they read as examples and must not rot.
 */
const nightshiftDir = join(
	import.meta.dir,
	"..",
	"..",
	"..",
	"..",
	".nightshift",
);
const flowsDir = join(nightshiftDir, "flows");

/**
 * The import of a project folder on this computer: it gives the project's
 * profiles to this computer under their names, so every name a node of
 * format 6 gives finds its profile here.
 */
const importedHere: FlowMigration = {
	deviceId: "this-computer",
	deviceIdByName: () => null,
	profileIdByName: (_device, name) => name,
};

/** Flows a person drew in the editor while trying it out: kept as they are, not checked. */
const SCRATCH = new Set(["sadfsdf"]);

const readJson = (path: string): unknown =>
	JSON.parse(readFileSync(path, "utf8"));

const parsed = readdirSync(flowsDir)
	.filter((name) => name.endsWith(".json"))
	.map((name) => name.slice(0, -".json".length))
	.filter((name) => !SCRATCH.has(name))
	.sort()
	.map((name) => {
		const raw = readJson(join(flowsDir, `${name}.json`));
		return { name, raw, ...parseFlow(raw, { migration: importedHere }) };
	});
const flows: Record<string, Flow | null> = Object.fromEntries(
	parsed.map(({ name, flow }) => [name, flow]),
);

describe("Night Shift's own flows", () => {
	test("the flows are there", () => {
		expect(parsed.map(({ name }) => name)).toEqual([
			"dependency-bump",
			"night-chores",
			"pr-review",
		]);
	});

	for (const { name, raw, flow, issues } of parsed) {
		test(`${name}.json is format 6, the last one in a project folder, and parses`, () => {
			expect((raw as { version?: unknown }).version).toBe(6);
			expect(flow === null ? issues : []).toEqual([]);
		});

		test(`${name}.json has no errors and no warnings`, () => {
			if (flow === null) throw new Error(`${name}.json does not parse.`);
			expect(validateFlow(flow, { flows, name })).toEqual([]);
		});
	}

	test("the profiles file is valid and holds every profile the flows name", () => {
		const { profiles, issues } = parseProfilesSource({
			json: readJson(join(nightshiftDir, "profiles.json")),
		});
		expect(issues).toEqual([]);
		const names = new Set(profiles.map((profile) => profile.name));
		const named = parsed.flatMap(({ flow }) =>
			(flow?.nodes ?? []).flatMap((node) => {
				const profile = profileOf(node);
				return isProfileRef(profile) ? [profile.profile] : [];
			}),
		);
		expect(named.filter((profile) => !names.has(profile))).toEqual([]);
	});

	test("the schedules start these flows without an issue", () => {
		const file = schedulesFileSchema.parse(
			readJson(join(nightshiftDir, "schedules.json")),
		);
		const info = Object.fromEntries(
			Object.entries(flows).map(([name, flow]) => [
				name,
				flow === null
					? null
					: {
							inputs: flow.inputs,
							errorCount: validateFlow(flow, { flows, name }).filter(
								(issue) => issue.severity === "error",
							).length,
						},
			]),
		);
		expect(validateSchedules(file.schedules, info)).toEqual([]);
		// This repo's main checkout runs a live Night Shift: a person turns them on.
		expect(file.schedules.filter((schedule) => schedule.enabled)).toEqual([]);
	});
});

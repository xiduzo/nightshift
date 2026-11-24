import { describe, expect, test } from "bun:test";

import { BadArguments } from "./args";
import { mergeOptions } from "./merge";
import { previewLines, resultLines } from "./merge-words";

describe("nightshift merge", () => {
	test("asks first, without flags", () => {
		expect(mergeOptions([], {})).toEqual({
			dryRun: false,
			yes: false,
			join: [],
			daemon: "http://localhost:3000",
		});
	});

	test("--dry-run only shows, --join names projects for a shared Space", () => {
		expect(
			mergeOptions(["--dry-run", "--join", "api", "--join", "web", "-y"], {}),
		).toMatchObject({ dryRun: true, yes: true, join: ["api", "web"] });
	});

	test("an unknown flag or a --join without a project shows the help", () => {
		expect(() => mergeOptions(["--force"], {})).toThrow(BadArguments);
		expect(() => mergeOptions(["--join"], {})).toThrow(BadArguments);
	});

	test("the preview says where each project goes", () => {
		const lines = previewLines({
			host: { id: "h", name: "studio" },
			runs: 3,
			projects: [
				{
					id: "p1",
					name: "app",
					remote: "github.com/acme/app",
					removed: false,
					runs: 2,
					into: "same-remote",
					sharedSpace: null,
					renamedFlows: [{ from: "triage", to: "triage-2" }],
					schedules: 1,
				},
				{
					id: "p2",
					name: "api",
					remote: "github.com/acme/api",
					removed: false,
					runs: 1,
					into: "apart",
					sharedSpace: { id: "s", name: "Platform" },
					renamedFlows: [],
					schedules: 0,
				},
			],
		});
		expect(lines).toEqual([
			"Your Personal merges into the Personal of studio. 2 projects and 3 runs move:",
			"  - app (github.com/acme/app): 2 runs, joins the project with this repository on studio",
			'      flow "triage" is now "triage-2"',
			"      1 schedule keeps firing on this computer",
			"  - api (github.com/acme/api): 1 run, stays apart from the project with this repository in Platform",
		]);
	});

	test("a merge whose runs did not reach the Host yet says they follow", () => {
		expect(
			resultLines(
				{ state: "moved", projects: 1, runs: 2, backup: "/data/copy.db" },
				"studio",
			),
		).toContain("Your runs go to studio as soon as it answers.");
	});
});

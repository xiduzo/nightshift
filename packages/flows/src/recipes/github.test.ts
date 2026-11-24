import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderCommand } from "../template";
import { githubSubIssuesCommand } from "./github";

describe("githubSubIssuesCommand", () => {
	test("the command reads the sub-issues of the parent with the filters", () => {
		const command = githubSubIssuesCommand({
			parent: "{{epic}}",
			requireLabel: "Feature",
			doneLabels: ["Done", "shipped"],
			skipLabels: ["draft"],
		});
		expect(command).toContain(`-F number="{{epic}}"`);
		expect(command).toContain("-F owner='{owner}' -F name='{repo}'");
		expect(command).toContain("subIssues(first: 100)");
		expect(command).toContain("blockedBy(first: 50)");
		expect(command).toContain(
			`"feature" as $require | ["draft"] as $skip | ["done","shipped"] as $done`,
		);
		expect(command).not.toMatch(/mutation/);
	});

	test("without filters the knobs are null and empty; a label's quote is escaped for the shell", () => {
		const bare = githubSubIssuesCommand({ parent: "7" });
		expect(bare).toContain("null as $require | [] as $skip | [] as $done");
		expect(bare).toContain(`-F number="7"`);
		const quoted = githubSubIssuesCommand({
			parent: "7",
			doneLabels: ["won't fix"],
		});
		expect(quoted).toContain(`["won'\\''t fix"] as $done`);
	});

	const jq = Bun.which("jq");
	test.skipIf(!jq)(
		"the command prints the same items the engine's reader gave",
		() => {
			// A fake gh: it answers `api graphql --jq FILTER` with one page through jq.
			const dir = mkdtempSync(join(tmpdir(), "nightshift-gh-"));
			const page = join(dir, "page.json");
			const log = join(dir, "fields.txt");
			const issue = (
				number: number,
				labels: string[],
				extra: Record<string, unknown> = {},
			) => ({
				number,
				title: `Trace ${number}`,
				body: `Body of ${number}`,
				state: "OPEN",
				url: `https://github.com/acme/game/issues/${number}`,
				labels: { nodes: labels.map((name) => ({ name })) },
				blockedBy: { nodes: [] },
				...extra,
			});
			writeFileSync(
				page,
				JSON.stringify({
					data: {
						repository: {
							issue: {
								number: 10,
								title: "Feature: combat",
								subIssues: {
									nodes: [
										issue(11, ["trace"]),
										issue(12, ["Trace", "Implemented"], {
											body: null,
											blockedBy: {
												nodes: [
													{ number: 11, state: "OPEN" },
													{ number: 3, state: "CLOSED" },
												],
											},
										}),
										issue(13, ["trace", "Draft"]),
										issue(14, ["bug"], { state: "CLOSED" }),
									],
								},
							},
						},
					},
				}),
			);
			writeFileSync(
				join(dir, "gh"),
				[
					"#!/bin/sh",
					'filter=""',
					"while [ $# -gt 0 ]; do",
					'  case "$1" in',
					'    --jq) filter="$2"; shift ;;',
					`    -F|-f) printf '%s\\n' "$2" >> '${log}'; shift ;;`,
					"  esac",
					"  shift",
					"done",
					`exec '${jq}' "$filter" < '${page}'`,
					"",
				].join("\n"),
			);
			chmodSync(join(dir, "gh"), 0o755);

			const text = githubSubIssuesCommand({
				parent: "{{item.number}}",
				requireLabel: "trace",
				doneLabels: ["implemented"],
				skipLabels: ["draft"],
			});
			const { command, env } = renderCommand(text, {
				run: {
					flow: "feature",
					branch: "",
					base_branch: "",
					index: "",
					worktree: "",
					base_ref: "",
					due_at: "",
				},
				inputs: { item: { number: 10 } },
				nodes: {},
			});
			const result = Bun.spawnSync(["sh", "-c", command], {
				env: { ...process.env, ...env, PATH: `${dir}:${process.env.PATH}` },
			});
			expect(result.stderr.toString()).toBe("");
			expect(result.exitCode).toBe(0);
			const parent = { number: 10, title: "Feature: combat" };
			expect(JSON.parse(result.stdout.toString())).toEqual([
				{
					id: "11",
					number: 11,
					title: "Trace 11",
					body: "Body of 11",
					url: "https://github.com/acme/game/issues/11",
					state: "OPEN",
					labels: ["trace"],
					parent,
					dependsOn: [],
					done: false,
				},
				{
					id: "12",
					number: 12,
					title: "Trace 12",
					body: "",
					url: "https://github.com/acme/game/issues/12",
					state: "OPEN",
					labels: ["Trace", "Implemented"],
					parent,
					dependsOn: [
						{ id: "11", done: false },
						{ id: "3", done: true },
					],
					done: true,
				},
			]);
			const fields = readFileSync(log, "utf8").split("\n");
			expect(fields.slice(0, 3)).toEqual([
				"owner={owner}",
				"name={repo}",
				"number=10",
			]);
			expect(fields[3]).toStartWith("query=");
		},
	);
});

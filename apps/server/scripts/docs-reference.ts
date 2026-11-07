/**
 * Keeps the reference parts of the docs equal to the code, so a list in a
 * doc cannot drift from the product.
 *
 *   bun run docs:reference          # write the generated blocks
 *   bun run docs:reference --check  # exit 1 when a doc is out of date
 *
 * Two kinds of markers, in any tracked or new markdown file:
 *
 * - A generated block. This script writes everything between the markers.
 *
 *     <!-- generated:kits: bun run docs:reference writes this. -->
 *     ...
 *     <!-- /generated:kits -->
 *
 * - A checked table. A person writes the table. This script checks that its
 *   first column names exactly the items of the code: `name` or **Name**.
 *
 *     <!-- checked:nodes: every node type has one row. -->
 *     | Node | Does |
 *     ...
 *     <!-- /checked:nodes -->
 *
 * CI runs it with --check (.github/workflows/ci.yml). The wiki workflow
 * publishes docs/wiki/ (.github/workflows/wiki.yml).
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type TerminalPort, terminalTools } from "@nightshift/agents";
import {
	HARNESS_CATALOG,
	isKnowledgeKit,
	kitList,
	NODE_TYPE_LABEL,
	starterList,
} from "@nightshift/flows";

const ROOT = join(import.meta.dir, "../../..");
const CLI = join(ROOT, "apps/server/src/cli.ts");
const COMMAND = "bun run docs:reference";

/** Escapes a value for one cell of a markdown table. */
export function cell(value: string): string {
	return value.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

/** A markdown table from a header and rows of cells. */
export function table(header: string[], rows: string[][]): string {
	return [
		`| ${header.join(" | ")} |`,
		`| ${header.map(() => "---").join(" | ")} |`,
		...rows.map((row) => `| ${row.join(" | ")} |`),
	].join("\n");
}

function kitsTable(knowledge: boolean): string {
	const rows = kitList()
		.filter((kit) => isKnowledgeKit(kit.name) === knowledge)
		.map((kit) => [
			`\`${kit.name}\``,
			cell(kit.flow.description ?? ""),
			kit.flow.inputs.map((input) => `\`${input.name}\``).join(", ") || "none",
		]);
	return table(["Kit", "Does", "Inputs"], rows);
}

type StarterInput = { name: string; default?: unknown };
type StarterSource = { description?: string; inputs?: StarterInput[] };

function startersTable(): string {
	const rows = starterList().map((starter) => {
		const source = starter.source as StarterSource;
		const inputs = (source.inputs ?? [])
			.map((input) =>
				input.default === undefined
					? `\`${input.name}\``
					: `\`${input.name}\` (default \`${String(input.default)}\`)`,
			)
			.join(", ");
		return [
			`\`${starter.name}\``,
			cell(source.description ?? ""),
			inputs || "none",
		];
	});
	return table(["Flow", "Does", "Inputs"], rows);
}

function harnessesTable(): string {
	const rows = Object.values(HARNESS_CATALOG).map((harness) => [
		`**${harness.label}**`,
		cell(harness.note),
		harness.tools ? "Yes" : "No",
		cell(harness.offMachine),
	]);
	return table(
		[
			"Agent",
			"Login and model",
			"Night Shift's own tools",
			"Where your code goes",
		],
		rows,
	);
}

/** The output of the `nightshift` command, from the source. */
function cliHelp(args: string[]): string {
	const result = spawnSync("bun", [CLI, ...args], {
		cwd: ROOT,
		encoding: "utf8",
	});
	const text = `${result.stdout ?? ""}`.trimEnd();
	if (text === "") {
		throw new Error(
			`nightshift ${args.join(" ")} printed nothing: ${result.stderr}`,
		);
	}
	return ["```text", text, "```"].join("\n");
}

/** The MCP tools of `nightshift mcp`. Their handlers never run here. */
function mcpToolNames(): string[] {
	return terminalTools({} as TerminalPort).map((tool) => tool.name);
}

/** What each generated block holds, by its name. */
export const GENERATED: Record<string, () => string> = {
	kits: () => kitsTable(false),
	"knowledge-kits": () => kitsTable(true),
	starters: startersTable,
	harnesses: harnessesTable,
	cli: () => cliHelp(["help"]),
	"cli-flows": () => cliHelp(["flows", "--help"]),
};

/** What each checked table must name, by its name. */
export const CHECKED: Record<string, () => string[]> = {
	nodes: () => Object.values(NODE_TYPE_LABEL),
	starters: () => starterList().map((starter) => starter.name),
	"mcp-tools": mcpToolNames,
};

/** A block: its kind, name and note, and the body between its markers (may be empty). */
const BLOCK =
	/<!-- (generated|checked):([a-z-]+)((?::[^>]*)?) -->\n(?:([\s\S]*?)\n)?<!-- \/\1:\2 -->/g;

export type Problem = { block: string; message: string };

/**
 * Writes every generated block of `text` and checks every checked table.
 * Pure but for the sources: it takes them as arguments.
 */
export function fill(
	text: string,
	generated: Record<string, () => string>,
	checked: Record<string, () => string[]>,
): { text: string; problems: Problem[] } {
	const problems: Problem[] = [];
	const filled = text.replace(
		BLOCK,
		(
			whole,
			kind: string,
			name: string,
			note: string,
			body: string | undefined,
		) => {
			const block = `${kind}:${name}`;
			if (kind === "generated") {
				const render = generated[name];
				if (!render) {
					problems.push({
						block,
						message: "has no generator. Check its name.",
					});
					return whole;
				}
				return `<!-- ${block}${note} -->\n${render()}\n<!-- /${block} -->`;
			}
			const expected = checked[name];
			if (!expected) {
				problems.push({
					block,
					message: "has no list to check. Check its name.",
				});
				return whole;
			}
			problems.push(...coverage(block, body ?? "", expected()));
			return whole;
		},
	);
	return { text: filled, problems };
}

/** The names in the first column of each body row of a table. */
export function firstColumnNames(body: string): string[] {
	const rows = body
		.split("\n")
		.filter((line) => line.trimStart().startsWith("|"))
		.slice(2);
	const names: string[] = [];
	for (const row of rows) {
		const first = row.split(/(?<!\\)\|/)[1] ?? "";
		for (const match of first.matchAll(/`([^`]+)`|\*\*([^*]+)\*\*/g)) {
			names.push((match[1] ?? match[2] ?? "").trim());
		}
	}
	return names;
}

function coverage(block: string, body: string, expected: string[]): Problem[] {
	const named = new Set(firstColumnNames(body));
	const want = new Set(expected);
	const problems: Problem[] = [];
	const missing = expected.filter((name) => !named.has(name));
	const extra = [...named].filter((name) => !want.has(name));
	if (missing.length > 0)
		problems.push({ block, message: `misses ${missing.join(", ")}.` });
	if (extra.length > 0)
		problems.push({
			block,
			message: `names ${extra.join(", ")}, which the code does not have.`,
		});
	return problems;
}

/** Every markdown file of the repository, tracked or new. */
function markdownFiles(): string[] {
	const result = spawnSync(
		"git",
		["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"],
		{ cwd: ROOT, encoding: "utf8" },
	);
	return result.stdout.split("\n").filter((file) => file !== "");
}

function main(): void {
	const check = process.argv.includes("--check");
	const lines: string[] = [];
	let failed = false;
	for (const file of markdownFiles()) {
		const path = join(ROOT, file);
		const before = readFileSync(path, "utf8");
		if (
			!before.includes("<!-- generated:") &&
			!before.includes("<!-- checked:")
		)
			continue;
		const { text, problems } = fill(before, GENERATED, CHECKED);
		for (const problem of problems) {
			failed = true;
			lines.push(`${file}: ${problem.block} ${problem.message}`);
		}
		if (text === before) continue;
		if (check) {
			failed = true;
			lines.push(`${file}: a generated block is out of date. Run ${COMMAND}.`);
		} else {
			writeFileSync(path, text);
			lines.push(`${file}: written.`);
		}
	}
	for (const line of lines) console.log(line);
	if (failed) process.exit(1);
}

if (import.meta.main) main();

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
 * A generator gets the path of the file it fills: the `needs` block of
 * `community/<name>/README.md` reads the `flow.json` next to it.
 *
 * It also checks each flow of `community/`: the flow must load as an import
 * loads it and pass the check of a save, with no user path and no Keychain.
 *
 * CI runs it with --check (.github/workflows/ci.yml). The wiki workflow
 * publishes docs/wiki/ (.github/workflows/wiki.yml).
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { type TerminalPort, terminalTools } from "@nightshift/agents";
import {
	type AgentNode,
	calledFlowNames,
	cascadeOf,
	type DeciderName,
	decisionDecider,
	FLOW_VERSION,
	type Flow,
	type FlowNode,
	flowConfigUse,
	flowSchema,
	flowSecrets,
	HARNESS_CATALOG,
	isCustomHarness,
	isKitName,
	isKnowledgeKit,
	kitList,
	migrateFlow,
	NODE_FAMILY_LABEL,
	NODE_TYPE_LABEL,
	type ProjectFlowMap,
	proposalIssues,
	starterList,
	tierNode,
	valueDecider,
} from "@nightshift/flows";

const ROOT = join(import.meta.dir, "../../..");
const CLI = join(ROOT, "apps/server/src/cli.ts");
const COMMAND = "bun run docs:reference";
const COMMUNITY = join(ROOT, "community");
const COMMUNITY_URL =
	"https://github.com/xiduzo/nightshift/tree/main/community";

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
			NODE_FAMILY_LABEL[kit.family],
			cell(kit.flow.description ?? ""),
			kit.flow.inputs.map((input) => `\`${input.name}\``).join(", ") || "none",
		]);
	return table(["Kit", "Family", "Does", "Inputs"], rows);
}

type StarterInput = { name: string; default?: unknown };
type StarterSource = { description?: string; inputs?: StarterInput[] };

/** The starters a person sees. A helper (`partOf`) installs with its parent. */
function listedStarters() {
	return starterList().filter((starter) => starter.partOf === undefined);
}

function startersTable(): string {
	const rows = listedStarters().map((starter) => {
		const source = starter.source as StarterSource;
		const inputs = (source.inputs ?? [])
			.map((input) =>
				input.default === undefined
					? `\`${input.name}\``
					: `\`${input.name}\` (default \`${String(input.default)}\`)`,
			)
			.join(", ");
		const helpers = starterList()
			.filter((helper) => helper.partOf === starter.name)
			.map((helper) => `\`${helper.name}\``);
		const comesWith =
			helpers.length > 0 ? ` It comes with ${helpers.join(" and ")}.` : "";
		// A default may hold a `|` (a regular expression): `cell` escapes it.
		return [
			`\`${starter.name}\``,
			cell(`${source.description ?? ""}${comesWith}`),
			cell(inputs) || "none",
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
			"Where your files go",
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

/** One kind of thing a flow needs, and the names of what it needs of that kind. */
export type Need = { kind: string; names: string[] };

/** Every node of a flow as it runs: a node with a cascade once per tier. */
function runningNodes(flow: Flow): FlowNode[] {
	return flow.nodes.flatMap((node) => {
		const tiers = (cascadeOf(node) ?? [])
			.map((_, index) => tierNode(node, index))
			.filter((tier): tier is FlowNode => tier !== null);
		return tiers.length > 0 ? tiers : [node];
	});
}

function agentOf(node: AgentNode): string {
	if (node.harness === undefined) return "an Agent Profile";
	const harness = isCustomHarness(node.harness)
		? `\`${node.harness}\``
		: HARNESS_CATALOG[node.harness].label;
	return node.model ? `${harness} · \`${node.model}\`` : harness;
}

function modelOf(node: {
	profile?: unknown;
	model?: string;
	decider: DeciderName;
}): string {
	if (node.profile !== undefined) return "a Model Profile";
	return node.model
		? `\`${node.decider}\` · \`${node.model}\``
		: `\`${node.decider}\``;
}

const code = (names: Iterable<string>) =>
	[...names].map((name) => `\`${name}\``);

/**
 * What a flow needs on the computer that runs it: its agents and models,
 * CLI tools, secrets and connections (MCP servers) (`flowConfigUse`,
 * `flowSecrets`: the kits it calls add theirs), kits, the flows it calls,
 * and skills. Only the kinds it needs, each name once.
 */
export function flowNeeds(flow: Flow): Need[] {
	const agents = new Set<string>();
	const models = new Set<string>();
	const kits = new Set<string>();
	const flows = new Set<string>();
	const skills = new Set<string>();
	for (const node of runningNodes(flow)) {
		switch (node.type) {
			case "agent":
				agents.add(agentOf(node));
				if (node.skill !== undefined) skills.add(node.skill);
				break;
			case "decision":
				if (node.by === "model")
					models.add(modelOf({ ...node, decider: decisionDecider(node) }));
				break;
			case "value":
				if (node.by === "model")
					models.add(modelOf({ ...node, decider: valueDecider(node) }));
				break;
			case "call":
				for (const name of calledFlowNames(node))
					(isKitName(name) ? kits : flows).add(name);
				break;
		}
	}
	const named = flowConfigUse(flow);
	const needs: Need[] = [
		{ kind: "Agents", names: [...agents] },
		{ kind: "Models", names: [...models] },
		{ kind: "CLI tools", names: code(named.clis) },
		{
			kind: "Secrets",
			names: flowSecrets(flow).map((name) => `\`\${${name}}\``),
		},
		{ kind: "Connections (MCP servers)", names: code(named.connections) },
		{ kind: "Kits", names: code(kits) },
		{ kind: "Flows it calls", names: code(flows) },
		{ kind: "Skills", names: code(skills) },
	];
	return needs.filter((need) => need.names.length > 0);
}

/** The `needs` block: one line per kind. */
export function needsList(needs: readonly Need[]): string {
	if (needs.length === 0) return "- Night Shift only.";
	return needs
		.map((need) => `- ${need.kind}: ${need.names.join(", ")}`)
		.join("\n");
}

/** One flow of `community/`: the flow, or null when it does not load, and its problems. */
export type CommunityFlow = {
	name: string;
	flow: Flow | null;
	problems: string[];
};

/**
 * Text that ties a flow to one computer: a user's own folder or the macOS
 * Keychain. A shared flow names a secret instead.
 */
const BREACHES: readonly { pattern: RegExp; message: string }[] = [
	{
		pattern: /\/Users\/|\/home\//,
		message:
			"It names a folder of one user (/Users/ or /home/). Use a path in the project.",
	},
	{
		pattern: /~\//,
		message: "It names a home folder (~/). Use a path in the project.",
	},
	{
		pattern: /keychain|find-(?:generic|internet)-password/i,
		message:
			"It reads the Keychain. Name a secret in the secrets of the Command node instead.",
	},
];

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** A flow file's JSON at the current format, or null when it does not parse. */
function currentFlow(json: unknown): Flow | null {
	const parsed = flowSchema.safeParse(migrateFlow(json));
	return parsed.success ? parsed.data : null;
}

/**
 * One flow of `community/` from the text of its `flow.json`. It loads as an
 * import loads a file (JSON, then `migrateFlow`) and must pass the check a
 * save makes (`proposalIssues`, which `check_flow` calls). `flows` are the
 * flows it may call, by name.
 */
export function loadCommunityFlow(
	name: string,
	text: string,
	flows: ProjectFlowMap = {},
): CommunityFlow {
	const problems = BREACHES.filter(({ pattern }) => pattern.test(text)).map(
		({ message }) => message,
	);
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch (error) {
		problems.push(`It is not valid JSON: ${errorText(error)}`);
		return { name, flow: null, problems };
	}
	const migrated = migrateFlow(json);
	const version = (migrated as { version?: unknown } | null)?.version;
	if (typeof version === "number" && version > FLOW_VERSION) {
		problems.push(
			`Its format is ${version}, and Night Shift reads up to format ${FLOW_VERSION}.`,
		);
		return { name, flow: null, problems };
	}
	// A community flow has no project: its place holds only the flows it may
	// call. No Devices or connections to check against, so the base is never
	// read: the flow stands in for it, as `check_flow` does for a new flow.
	const errors = proposalIssues(migrated as Flow, migrated, { flows, name })
		.filter((issue) => issue.severity === "error")
		.map((issue) => issue.message);
	problems.push(...errors);
	const flow = errors.length === 0 ? currentFlow(json) : null;
	return { name, flow, problems };
}

/** The folders of `dir` that hold a `flow.json`, by name. */
function communityNames(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter(
			(entry) =>
				entry.isDirectory() && existsSync(join(dir, entry.name, "flow.json")),
		)
		.map((entry) => entry.name)
		.sort();
}

/**
 * Every flow of `community/`, checked. A flow may call a starter or another
 * community flow, as a project that imported them would have it.
 */
export function communityFlows(dir: string = COMMUNITY): CommunityFlow[] {
	const files = communityNames(dir).map((name) => ({
		name,
		text: readFileSync(join(dir, name, "flow.json"), "utf8"),
	}));
	const callable: Record<string, Flow | null> = {};
	for (const starter of starterList())
		callable[starter.name] = currentFlow(starter.source);
	for (const { name, text } of files) {
		try {
			callable[name] = currentFlow(JSON.parse(text));
		} catch {
			callable[name] = null;
		}
	}
	return files.map(({ name, text }) => loadCommunityFlow(name, text, callable));
}

/** The `needs` block of `community/<name>/README.md`, from the `flow.json` next to it. */
function needsOf(file: string): string {
	const dir = dirname(file);
	const path = join(dir, "flow.json");
	if (!existsSync(path)) throw new Error("needs a flow.json next to it.");
	const { flow } = loadCommunityFlow(basename(dir), readFileSync(path, "utf8"));
	// The check of the community flows names why: `main` prints it.
	if (flow === null) throw new Error("reads a flow.json that does not load.");
	return needsList(flowNeeds(flow));
}

/** The community flows for the wiki: each links to its folder. */
export function communityTable(flows: readonly CommunityFlow[]): string {
	const rows = flows.flatMap(({ name, flow }) => {
		if (flow === null) return [];
		const needs = flowNeeds(flow);
		return [
			[
				`[\`${name}\`](${COMMUNITY_URL}/${name})`,
				cell(flow.description ?? ""),
				needs.length === 0
					? "Night Shift only."
					: cell(
							needs
								.map((need) => `${need.kind}: ${need.names.join(", ")}.`)
								.join(" "),
						),
			],
		];
	});
	return table(["Flow", "Does", "Needs"], rows);
}

/**
 * What each generated block holds, by its name. A generator gets the path
 * of the file it fills.
 */
export const GENERATED: Record<string, (file: string) => string> = {
	kits: () => kitsTable(false),
	"knowledge-kits": () => kitsTable(true),
	starters: startersTable,
	harnesses: harnessesTable,
	cli: () => cliHelp(["help"]),
	"cli-flows": () => cliHelp(["flows", "--help"]),
	needs: needsOf,
	community: () => communityTable(communityFlows()),
};

/** What each checked table must name, by its name. */
export const CHECKED: Record<string, () => string[]> = {
	nodes: () => Object.values(NODE_TYPE_LABEL),
	starters: () => listedStarters().map((starter) => starter.name),
	"mcp-tools": mcpToolNames,
	community: () => communityNames(COMMUNITY),
};

/** A block: its kind, name and note, and the body between its markers (may be empty). */
const BLOCK =
	/<!-- (generated|checked):([a-z-]+)((?::[^>]*)?) -->\n(?:([\s\S]*?)\n)?<!-- \/\1:\2 -->/g;

export type Problem = { block: string; message: string };

/**
 * Writes every generated block of `text` and checks every checked table.
 * Pure but for the sources: it takes them as arguments. `file` is the path
 * of the file that holds `text`, for a generator that reads next to it. A
 * generator that throws leaves its block as it is, and its message is a
 * problem.
 */
export function fill(
	text: string,
	generated: Record<string, (file: string) => string>,
	checked: Record<string, () => string[]>,
	file = "",
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
				let body: string;
				try {
					body = render(file);
				} catch (error) {
					problems.push({ block, message: errorText(error) });
					return whole;
				}
				return `<!-- ${block}${note} -->\n${body}\n<!-- /${block} -->`;
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
		const { text, problems } = fill(before, GENERATED, CHECKED, path);
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
	for (const { name, problems } of communityFlows()) {
		for (const problem of problems) {
			failed = true;
			lines.push(`community/${name}/flow.json: ${problem}`);
		}
	}
	for (const line of lines) console.log(line);
	if (failed) process.exit(1);
}

if (import.meta.main) main();

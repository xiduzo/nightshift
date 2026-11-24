import { existsSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { chooseProject } from "@nightshift/agents";
import type { AppRouterClient } from "@nightshift/api";
import {
	agentKey,
	canonicalFlowJson,
	type FlowAgent,
	type FlowIssue,
	flowAgents,
	flowNameOfFile,
	parseFlow,
	prefilledProfile,
} from "@nightshift/flows";
import { iso } from "@nightshift/time";
import { daemonCommand } from "./command";
import {
	FLOWS_USAGE,
	type FlowsAction,
	type FlowsOptions,
	flowsOptions,
} from "./flows-options";

/**
 * `nightshift flows <action>`: read and save the flows of a project, for
 * a person or an agent in a terminal. Night Shift keeps the flows, so
 * these go through Night Shift on this computer, over its API, like the
 * editor does. Each save is a new revision of the flow.
 *
 * The project: `--project <id, name or folder>`, else the project whose
 * Clone holds the folder the command runs in, else the only project.
 * Output is plain: JSON or one line per item on stdout, problems on
 * stderr. The exit code is 1 when nothing was saved or read.
 */

/** What `runFlows` reads and writes besides Night Shift. */
export type FlowsIo = {
	/** Writes to stdout as it is. */
	out(text: string): void;
	/** Writes one line to stderr. */
	err(line: string): void;
	/** The text of a file, or of stdin when `file` is null. */
	read(file: string | null): Promise<string>;
	write(file: string, text: string): Promise<void>;
	isFolder(path: string): boolean;
};

export type FlowsClient = Pick<
	AppRouterClient,
	"projects" | "flows" | "profiles"
>;

/** The process's stdin, stdout, stderr and files. */
export const processIo: FlowsIo = {
	out: (text) => process.stdout.write(text),
	err: (line) => process.stderr.write(`${line}\n`),
	read: (file) => (file === null ? Bun.stdin.text() : readFile(file, "utf8")),
	write: (file, text) => writeFile(file, text),
	isFolder: (path) => existsSync(path) && statSync(path).isDirectory(),
};

function issueLine(issue: FlowIssue): string {
	const at = issue.nodeId
		? ` (node ${issue.nodeId})`
		: issue.edgeId
			? ` (edge ${issue.edgeId})`
			: issue.sectionId
				? ` (section ${issue.sectionId})`
				: "";
	return `${issue.severity}: ${issue.message}${at}`;
}

/** The issues on stderr, and a line that says the flow cannot run when it has errors. */
function report(io: FlowsIo, issues: FlowIssue[]): void {
	for (const issue of issues) io.err(issueLine(issue));
	const errors = issues.filter((issue) => issue.severity === "error").length;
	if (errors > 0) {
		io.err(
			`The flow has ${errors === 1 ? "1 error" : `${errors} errors`}. It cannot run until you fix ${errors === 1 ? "it" : "them"}.`,
		);
	}
}

/** The flow of a text, or null after its problems went to stderr. */
function flowOfText(io: FlowsIo, text: string, from: string | null) {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch (error) {
		io.err(
			`${from ? basename(from) : "The input"} is not valid JSON: ${(error as Error).message}`,
		);
		return null;
	}
	const parsed = parseFlow(json);
	if (!parsed.flow) {
		io.err(`${from ? basename(from) : "The input"} is not a valid flow.`);
		report(io, parsed.issues);
		return null;
	}
	return parsed.flow;
}

/** The agents of the flow in a text. None when it is not a flow: the import says why. */
function agentsOfText(text: string): FlowAgent[] {
	try {
		const parsed = parseFlow(JSON.parse(text));
		return parsed.flow ? flowAgents([parsed.flow]) : [];
	} catch {
		return [];
	}
}

/** One choice of the import: your profile, by its id, for an agent of the flow. */
type AgentChoiceInput = FlowAgent & { profile: string };

/**
 * Your profile for each agent of the flow: the one `--agent` names, else
 * the prefilled one. The lines say what it chose. Null after a problem
 * went to stderr.
 */
async function chooseAgents(
	client: FlowsClient,
	io: FlowsIo,
	text: string,
	command: Extract<FlowsAction, { action: "import" }>,
): Promise<{ choices: AgentChoiceInput[]; lines: string[] } | null> {
	const agents = agentsOfText(text);
	const keys = agents.map(agentKey);
	const named = keys.length > 0 ? keys.join(", ") : "none";
	const unknown = command.agents.find((each) => !keys.includes(each.agent));
	if (unknown) {
		io.err(
			`The flow does not name the agent ${unknown.agent}. Its agents: ${named}.`,
		);
		return null;
	}
	if (agents.length === 0) return { choices: [], lines: [] };
	if (command.keepAgents) {
		return { choices: [], lines: [`Keeps its agents: ${named}.`] };
	}
	// Only the owner of this computer sees its profiles: others keep the agents.
	const profiles = await client.profiles.list().then(
		(rows) => rows.flatMap((row) => ("harness" in row ? [row] : [])),
		() => [],
	);
	if (profiles.length === 0) {
		if (command.agents.length > 0) {
			io.err(
				"This computer has no agent profiles yet. Add one on the Agents page, or leave out --agent.",
			);
			return null;
		}
		return {
			choices: [],
			lines: [
				`Keeps its agents: ${named}. Add an agent profile to choose your own.`,
			],
		};
	}
	const choices: AgentChoiceInput[] = [];
	const lines: string[] = [];
	for (const agent of agents) {
		const key = agentKey(agent);
		const wanted = command.agents.find((each) => each.agent === key)?.profile;
		const profile =
			wanted === undefined
				? prefilledProfile(agent, profiles)
				: (profiles.find((each) => each.name === wanted) ??
					profiles.find((each) => each.id === wanted));
		if (profile === undefined) {
			io.err(
				`This computer has no agent profile "${wanted}". Its profiles: ${profiles.map((each) => each.name).join(", ")}.`,
			);
			return null;
		}
		choices.push({ ...agent, profile: profile.id });
		lines.push(`${key} -> ${profile.name} (${agentKey(profile)})`);
	}
	return { choices, lines };
}

function changeSummary(
	changes: Awaited<
		ReturnType<FlowsClient["flows"]["revisions"]>
	>[number]["changes"],
): string {
	if (!changes) return "-";
	if (changes.empty) return "no changes";
	const parts = [
		changes.added > 0 ? `${changes.added} added` : null,
		changes.removed > 0 ? `${changes.removed} removed` : null,
		changes.changed > 0 ? `${changes.changed} changed` : null,
		changes.moved > 0 ? `${changes.moved} moved` : null,
		changes.edges > 0 ? `${changes.edges} edges` : null,
		changes.other > 0 ? `${changes.other} other` : null,
	].filter((part) => part !== null);
	return parts.join(", ");
}

/** Runs one `flows` action. Returns the exit code. */
export async function runFlows(
	options: FlowsOptions,
	client: FlowsClient,
	io: FlowsIo,
): Promise<number> {
	const projects = (await client.projects.list()).map((p) => ({
		id: p.id,
		name: p.name,
		path: p.repoPath,
	}));
	const choice = chooseProject(projects, options.project, options.folder);
	if (choice.kind !== "found") {
		const known = projects.map((p) => `  ${p.name} (${p.id})`).join("\n");
		io.err(
			choice.kind === "none"
				? "Night Shift has no projects yet. Add one in Night Shift first."
				: choice.kind === "unknown"
					? `Night Shift has no project "${choice.wanted}". Its projects:\n${known}`
					: `Name the project with --project. Its projects:\n${known}`,
		);
		return 1;
	}
	const projectId = choice.project.id;
	const command = options.command;
	/** `text` to the file of `--out`, else stdout. */
	const emit = async (text: string, out: string | null) => {
		if (out === null) io.out(text);
		else await io.write(out, text);
	};

	switch (command.action) {
		case "list": {
			const flows = await client.flows.list({ projectId });
			if (command.json) {
				io.out(`${JSON.stringify(flows, null, 2)}\n`);
				return 0;
			}
			for (const flow of flows) {
				io.out(
					`${[
						flow.name,
						flow.nodeCount === null ? "not valid" : `${flow.nodeCount} steps`,
						`${flow.errorCount} errors`,
						flow.description ?? "",
					].join("\t")}\n`,
				);
			}
			return 0;
		}
		case "get": {
			const loaded = await client.flows.get({ projectId, name: command.name });
			if (!loaded.flow) {
				io.err(`The flow "${command.name}" is not valid.`);
				report(io, loaded.issues);
				return 1;
			}
			await emit(canonicalFlowJson(loaded.flow), command.out);
			return 0;
		}
		case "save": {
			const flow = flowOfText(io, await io.read(command.file), command.file);
			if (!flow) return 1;
			const issues = await client.flows.save({
				projectId,
				name: command.name,
				flow,
			});
			report(io, issues);
			io.out(`${command.name}\n`);
			return 0;
		}
		case "export": {
			const file = await client.flows.export({ projectId, name: command.name });
			const out =
				command.out !== null && io.isFolder(command.out)
					? join(command.out, file.fileName)
					: command.out;
			await emit(file.json, out);
			if (out !== null) io.out(`${out}\n`);
			return 0;
		}
		case "import": {
			const text = await io.read(command.file);
			const name =
				command.name ??
				flowNameOfFile(importedFileName(command.file as string));
			const chosen = await chooseAgents(client, io, text, command);
			if (chosen === null) return 1;
			const saved = await client.flows.import({
				projectId,
				name,
				json: text,
				agents: chosen.choices,
			});
			for (const line of chosen.lines) io.err(line);
			report(io, saved.issues);
			io.out(`${saved.name}\n`);
			return 0;
		}
		case "revisions": {
			const revisions = await client.flows.revisions({
				projectId,
				name: command.name,
			});
			if (command.json) {
				io.out(`${JSON.stringify(revisions, null, 2)}\n`);
				return 0;
			}
			for (const revision of revisions) {
				io.out(
					`${[
						revision.id,
						iso(revision.at),
						revision.kind,
						revision.person?.name ?? revision.person?.id ?? "-",
						revision.device.name ?? revision.device.id,
						changeSummary(revision.changes),
						revision.current ? "current" : "",
					].join("\t")}\n`,
				);
			}
			return 0;
		}
		case "revision": {
			const view = await client.flows.revision({
				projectId,
				name: command.name,
				revisionId: command.revisionId,
			});
			if (!view.revision.flow) {
				io.err(
					`Revision ${command.revisionId} of "${command.name}" is not a valid flow.`,
				);
				return 1;
			}
			await emit(canonicalFlowJson(view.revision.flow), command.out);
			return 0;
		}
	}
}

export const flowsCommand = daemonCommand({
	name: "flows",
	help: `  nightshift flows <action> [options]       Read and save the flows of a project:
                                            list, get, save, export, import,
                                            revisions, revision.
                                            nightshift flows --help for the details.`,
	usage: (program) => FLOWS_USAGE.replaceAll("nightshift flows", program),
	asksUsage: (argv) =>
		argv[0] === "help" || argv.some((arg) => arg === "--help" || arg === "-h"),
	options: (argv) => flowsOptions(argv, process.env, process.cwd()),
	run: (client, options) => runFlows(options, client, processIo),
});

/**
 * The file name that names an imported flow. A `flow.json` takes the name of
 * its folder, as in `community/<name>/flow.json`.
 */
export function importedFileName(file: string): string {
	const name = basename(file);
	return name.toLowerCase() === "flow.json"
		? `${basename(dirname(resolve(file)))}.json`
		: name;
}

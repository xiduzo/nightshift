import { existsSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { chooseProject } from "@nightshift/agents";
import type { AppRouterClient } from "@nightshift/api";
import {
	canonicalFlowJson,
	type FlowIssue,
	flowNameOfFile,
	flowNameSchema,
	parseFlow,
} from "@nightshift/flows";
import { ORPCError } from "@orpc/client";

import { daemonClient, defaultDaemonUrl } from "./join";

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

export const FLOWS_USAGE = `Usage:
  nightshift flows list [--json]              The flows of the project: name, steps,
                                              errors and description, one per line.
  nightshift flows get <name> [--out <file>]  The flow as JSON.
  nightshift flows save <name> [<file>]       Save the flow of the file (else of stdin)
                                              as <name>: a new flow, or a new revision.
  nightshift flows export <name> [--out <file or folder>]
                                              The flow as a file to import elsewhere.
  nightshift flows import <file> [--name <name>]
                                              Save the flow of the file as a new flow.
                                              A name the project has gets a suffix.
                                              Prints the name it got.
  nightshift flows revisions <name> [--json]  The revisions of the flow, newest first.
  nightshift flows revision <name> <id> [--out <file>]
                                              One revision of the flow as JSON.

Options:
  --project <id, name or folder>  The project. Default: the project of this folder.
  --daemon <address>              Where Night Shift runs. NIGHTSHIFT_DAEMON_URL,
                                  default http://localhost:$PORT.
`;

export type FlowsAction =
	| { action: "list"; json: boolean }
	| { action: "get"; name: string; out: string | null }
	/** `file` null: read stdin. */
	| { action: "save"; name: string; file: string | null }
	| { action: "export"; name: string; out: string | null }
	/** `file` null: read stdin, and `name` is required. */
	| { action: "import"; file: string | null; name: string | null }
	| { action: "revisions"; name: string; json: boolean }
	| {
			action: "revision";
			name: string;
			revisionId: string;
			out: string | null;
	  };

export type FlowsOptions = {
	command: FlowsAction;
	project: string | null;
	daemon: string;
	/** The folder the command runs in. */
	folder: string;
};

const NAME_RULE =
	"Use lowercase letters, digits and -, starting with a letter or digit. Example: fix-issue.";

/** `flows`' arguments over the environment, or what is wrong with them. */
export function flowsOptions(
	argv: string[],
	env: Record<string, string | undefined>,
	cwd: string,
): FlowsOptions | { error: string } {
	const args = [...argv];
	const positional: string[] = [];
	let project: string | null = null;
	let daemon = defaultDaemonUrl(env);
	let out: string | null = null;
	let as: string | null = null;
	let json = false;
	while (args.length > 0) {
		const arg = args.shift() as string;
		const takes = ["--project", "--daemon", "--out", "--name"];
		if (takes.includes(arg)) {
			const value = args.shift();
			if (!value) return { error: `${arg} needs a value.` };
			if (arg === "--project") {
				// A folder becomes absolute; an id or a name stays as it is.
				project = existsSync(resolve(cwd, value)) ? resolve(cwd, value) : value;
			} else if (arg === "--daemon") daemon = value;
			else if (arg === "--out") out = resolve(cwd, value);
			else as = value;
		} else if (arg === "--json") json = true;
		else if (arg.startsWith("--"))
			return { error: `There is no option ${arg}.` };
		else positional.push(arg);
	}
	const [action, first, second, ...extra] = positional;
	const file = (value: string | undefined) =>
		value === undefined || value === "-" ? null : resolve(cwd, value);
	type Named = { name: string } | { error: string };
	const flowName = (
		value: string | undefined,
		what = "the flow's name",
	): Named => {
		if (value === undefined) return { error: `Give ${what}.` };
		return flowNameSchema.safeParse(value).success
			? { name: value }
			: { error: `"${value}" is not a flow name. ${NAME_RULE}` };
	};
	const unexpected = (
		from: (string | undefined)[],
	): { error: string } | null => {
		const rest = from.filter((value) => value !== undefined);
		return rest.length > 0
			? { error: `Too many arguments: ${rest.join(" ")}.` }
			: null;
	};

	let command: FlowsAction | { error: string };
	switch (action) {
		case "list": {
			command = unexpected([first, second, ...extra]) ?? { action, json };
			break;
		}
		case "get":
		case "export":
		case "revisions": {
			const named = flowName(first);
			command =
				"error" in named
					? named
					: (unexpected([second, ...extra]) ??
						(action === "revisions"
							? { action, name: named.name, json }
							: { action, name: named.name, out }));
			break;
		}
		case "save": {
			const named = flowName(first);
			command =
				"error" in named
					? named
					: (unexpected(extra) ?? {
							action,
							name: named.name,
							file: file(second),
						});
			break;
		}
		case "import": {
			const from = file(first);
			const named = as === null ? null : flowName(as, "the name in --name");
			if (named && "error" in named) command = named;
			else if (from === null && !named) {
				command = {
					error: "Give the flow's name in --name to import from stdin.",
				};
			} else {
				command = unexpected([second, ...extra]) ?? {
					action,
					file: from,
					name: named?.name ?? null,
				};
			}
			break;
		}
		case "revision": {
			const named = flowName(first);
			if ("error" in named) command = named;
			else if (second === undefined)
				command = { error: "Give the revision's id." };
			else {
				command = unexpected(extra) ?? {
					action,
					name: named.name,
					revisionId: second,
					out,
				};
			}
			break;
		}
		case undefined:
			command = { error: "Give an action." };
			break;
		default:
			command = { error: `There is no action ${action}.` };
	}
	if ("error" in command) return command;
	return {
		command,
		project,
		daemon: daemon.replace(/\/+$/, ""),
		folder: cwd,
	};
}

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

export type FlowsClient = Pick<AppRouterClient, "projects" | "flows">;

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
				command.name ?? flowNameOfFile(basename(command.file as string));
			const saved = await client.flows.import({ projectId, name, json: text });
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
						new Date(revision.at).toISOString(),
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

export async function flowsCommand(argv: string[], program: string) {
	const usage = FLOWS_USAGE.replaceAll("nightshift flows", program);
	if (
		argv[0] === "help" ||
		argv.some((arg) => arg === "--help" || arg === "-h")
	) {
		console.log(usage);
		return;
	}
	const options = flowsOptions(argv, process.env, process.cwd());
	if ("error" in options) {
		console.error(`${options.error}\n\n${usage}`);
		process.exit(2);
	}
	const client = await daemonClient(options.daemon);
	try {
		process.exitCode = await runFlows(options, client, processIo);
	} catch (error) {
		console.error(
			error instanceof ORPCError || error instanceof Error
				? error.message
				: String(error),
		);
		process.exitCode = 1;
	}
}

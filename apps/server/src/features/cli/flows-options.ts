import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { flowNameSchema } from "@nightshift/flows";
import { defaultDaemonUrl } from "./join";

/**
 * The arguments of `nightshift flows`: the usage text, the actions, and how
 * the command line becomes one of them (`flowsOptions`).
 */

export const FLOWS_USAGE = `Usage:
  nightshift flows list [--json]              The flows of the project: name, steps,
                                              errors and description, one per line.
  nightshift flows get <name> [--out <file>]  The flow as JSON.
  nightshift flows save <name> [<file>]       Save the flow of the file (else of stdin)
                                              as <name>: a new flow, or a new revision.
  nightshift flows export <name> [--out <file or folder>]
                                              The flow as a file to import elsewhere.
  nightshift flows import <file> [--name <name>] [--agent <agent>=<profile>]...
                                              Save the flow of the file as a new flow.
                                              A name the project has gets a suffix.
                                              Prints the name it got. One of your
                                              profiles takes each agent the flow names:
                                              the same harness and model, else the same
                                              harness, else your first profile. Prints
                                              each choice.
  nightshift flows revisions <name> [--json]  The revisions of the flow, newest first.
  nightshift flows revision <name> <id> [--out <file>]
                                              One revision of the flow as JSON.

Options:
  --project <id, name or folder>  The project. Default: the project of this folder.
  --daemon <address>              Where Night Shift runs. NIGHTSHIFT_DAEMON_URL,
                                  default http://localhost:$PORT.
  --agent <agent>=<profile>       With import: the profile for one agent of the flow,
                                  for example claude-code:opus=reviewer. Repeat it
                                  for each agent you choose.
  --keep-agents                   With import: keep the agents the flow names.
`;

/** `--agent claude-code:opus=reviewer`: the profile, by its name, for one agent of the flow. */
export type AgentOverride = { agent: string; profile: string };

export type FlowsAction =
	| { action: "list"; json: boolean }
	| { action: "get"; name: string; out: string | null }
	/** `file` null: read stdin. */
	| { action: "save"; name: string; file: string | null }
	| { action: "export"; name: string; out: string | null }
	/**
	 * `file` null: read stdin, and `name` is required. `agents`: the
	 * profiles the person chose. `keepAgents`: no profile replaces an agent.
	 */
	| {
			action: "import";
			file: string | null;
			name: string | null;
			agents: AgentOverride[];
			keepAgents: boolean;
	  }
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
	const agents: AgentOverride[] = [];
	let keepAgents = false;
	while (args.length > 0) {
		const arg = args.shift() as string;
		const takes = ["--project", "--daemon", "--out", "--name", "--agent"];
		if (takes.includes(arg)) {
			const value = args.shift();
			if (!value) return { error: `${arg} needs a value.` };
			if (arg === "--project") {
				// A folder becomes absolute; an id or a name stays as it is.
				project = existsSync(resolve(cwd, value)) ? resolve(cwd, value) : value;
			} else if (arg === "--daemon") daemon = value;
			else if (arg === "--out") out = resolve(cwd, value);
			else if (arg === "--agent") {
				const override = agentOverride(value);
				if (override === null) {
					return {
						error: `--agent needs an agent and a profile, for example claude-code:opus=reviewer. "${value}" is not one.`,
					};
				}
				agents.push(override);
			} else as = value;
		} else if (arg === "--json") json = true;
		else if (arg === "--keep-agents") keepAgents = true;
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

	if ((agents.length > 0 || keepAgents) && action !== "import") {
		return { error: "--agent and --keep-agents work with import only." };
	}
	if (agents.length > 0 && keepAgents) {
		return { error: "Use --agent or --keep-agents, not both." };
	}

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
					agents,
					keepAgents,
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

/**
 * `claude-code:opus=reviewer` as the agent and the profile's name. The
 * last `=` splits them: a profile's name has none.
 */
function agentOverride(value: string): AgentOverride | null {
	const at = value.lastIndexOf("=");
	const agent = value.slice(0, at).trim();
	const profile = value.slice(at + 1).trim();
	return at > 0 && agent.includes(":") && profile !== ""
		? { agent, profile }
		: null;
}

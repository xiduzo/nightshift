import { resolve } from "node:path";
import { flowNameSchema } from "@nightshift/flows";
import {
	BadArguments,
	needsValue,
	projectArgument,
	readArgs,
	required,
	turnOn,
} from "./args";
import { defaultDaemonUrl } from "./command";

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

/** The file an argument names, from the folder the command runs in. Null: stdin. */
function fileOf(cwd: string, value: string | undefined): string | null {
	return value === undefined || value === "-" ? null : resolve(cwd, value);
}

function flowName(value: string | undefined, what = "the flow's name"): string {
	if (value === undefined) throw new BadArguments(`Give ${what}.`);
	if (flowNameSchema.safeParse(value).success) return value;
	throw new BadArguments(`"${value}" is not a flow name. ${NAME_RULE}`);
}

/** Refuses the arguments from `from` on. */
function noMore(...from: (string | undefined)[]): void {
	const rest = from.filter((value) => value !== undefined);
	if (rest.length > 0) {
		throw new BadArguments(`Too many arguments: ${rest.join(" ")}.`);
	}
}

/** `flows`' arguments over the environment. Throws what is wrong with them. */
export function flowsOptions(
	argv: string[],
	env: Record<string, string | undefined>,
	cwd: string,
): FlowsOptions {
	const positional: string[] = [];
	let project: string | null = null;
	let daemon = defaultDaemonUrl(env);
	const given: Given = {
		out: null,
		as: null,
		json: false,
		agents: [],
		keepAgents: false,
	};
	const value = (to: (value: string) => void) => required(to, needsValue);
	readArgs(argv, {
		flags: {
			"--json": turnOn(given, "json"),
			"--keep-agents": turnOn(given, "keepAgents"),
		},
		values: {
			"--project": value((text) => {
				project = projectArgument(cwd, text);
			}),
			"--daemon": value((text) => {
				daemon = text;
			}),
			"--out": value((text) => {
				given.out = resolve(cwd, text);
			}),
			"--name": value((text) => {
				given.as = text;
			}),
			"--agent": value((text) => {
				given.agents.push(agentOverride(text));
			}),
		},
		other: (arg) => {
			if (arg.startsWith("--")) {
				throw new BadArguments(`There is no option ${arg}.`);
			}
			positional.push(arg);
		},
	});
	return {
		command: actionOf(positional, given, cwd),
		project,
		daemon: daemon.replace(/\/+$/, ""),
		folder: cwd,
	};
}

/** The options of an action. */
type Given = {
	out: string | null;
	/** `--name`. */
	as: string | null;
	json: boolean;
	agents: AgentOverride[];
	keepAgents: boolean;
};

function actionOf(
	[action, first, second, ...extra]: string[],
	{ out, as, json, agents, keepAgents }: Given,
	cwd: string,
): FlowsAction {
	if ((agents.length > 0 || keepAgents) && action !== "import") {
		throw new BadArguments("--agent and --keep-agents work with import only.");
	}
	if (agents.length > 0 && keepAgents) {
		throw new BadArguments("Use --agent or --keep-agents, not both.");
	}
	switch (action) {
		case "list":
			noMore(first, second, ...extra);
			return { action, json };
		case "get":
		case "export": {
			const name = flowName(first);
			noMore(second, ...extra);
			return { action, name, out };
		}
		case "revisions": {
			const name = flowName(first);
			noMore(second, ...extra);
			return { action, name, json };
		}
		case "save": {
			const name = flowName(first);
			noMore(...extra);
			return { action, name, file: fileOf(cwd, second) };
		}
		case "import": {
			const file = fileOf(cwd, first);
			const name = as === null ? null : flowName(as, "the name in --name");
			if (file === null && name === null) {
				throw new BadArguments(
					"Give the flow's name in --name to import from stdin.",
				);
			}
			noMore(second, ...extra);
			return { action, file, name, agents, keepAgents };
		}
		case "revision": {
			const name = flowName(first);
			if (second === undefined)
				throw new BadArguments("Give the revision's id.");
			noMore(...extra);
			return { action, name, revisionId: second, out };
		}
		case undefined:
			throw new BadArguments("Give an action.");
		default:
			throw new BadArguments(`There is no action ${action}.`);
	}
}

/**
 * `claude-code:opus=reviewer` as the agent and the profile's name. The
 * last `=` splits them: a profile's name has none.
 */
function agentOverride(value: string): AgentOverride {
	const at = value.lastIndexOf("=");
	const agent = value.slice(0, at).trim();
	const profile = value.slice(at + 1).trim();
	if (at > 0 && agent.includes(":") && profile !== "") {
		return { agent, profile };
	}
	throw new BadArguments(
		`--agent needs an agent and a profile, for example claude-code:opus=reviewer. "${value}" is not one.`,
	);
}

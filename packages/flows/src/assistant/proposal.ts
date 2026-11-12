/**
 * What "valid" means for a flow the assistant proposes. The backend's
 * `propose_flow` tool and the web both ask this one function, so the agent
 * and the person see the same issues.
 */

import {
	type CliToolRef,
	checkDraft,
	type DraftMessages,
	type FolderNeed,
} from "../draft";
import { FLOW_VERSION, type Flow, type FlowNode, flowSchema } from "../flow";
import { isProfileRef, type ProfileRef } from "../nodes";
import { everyProfileOf } from "../profiles";
import type { FlowIssue, ProjectFlowMap } from "../validate";

export type ProposalCheckOptions = {
	/** The project's flow files by name, so Call nodes can check the flows they call. */
	flows?: ProjectFlowMap;
	/** The flow's own file name. The proposal stands in for that file. */
	name?: string;
	/** The profiles a node may name, each on its Device. Leave it out to skip the check. */
	profiles?: readonly ProfileRef[];
	/** The names of this computer's connections. Leave it out to skip the check. */
	connections?: readonly string[];
	/** This computer's CLI tools, to warn about a program called without its login. */
	cliTools?: readonly CliToolRef[];
	/** Whether the project has a folder (ADR 22). False: a step that needs one warns. */
	folder?: boolean;
};

/**
 * The issues of `proposal`, a new version of `draft`: the flow schema first,
 * then the same checks as the editor (`checkDraft`, `validateFlow`).
 *
 * A profile or a connection the proposal names that this computer does not
 * have is an error, so the assistant does not invent one. A name the draft
 * already uses is left to the editor's own check: the person put it there.
 *
 * `proposal` is what the agent wrote, not yet read by the schema. A flow with
 * no `error` issue reads with `flowSchema.parse(proposal)`.
 */
export function proposalIssues(
	draft: Flow,
	proposal: unknown,
	options: ProposalCheckOptions = {},
): FlowIssue[] {
	const version =
		typeof proposal === "object" && proposal !== null
			? (proposal as { version?: unknown }).version
			: undefined;
	if (version !== FLOW_VERSION) {
		return [
			{
				severity: "error",
				message: `The flow must be an object with "version": ${FLOW_VERSION}.`,
			},
		];
	}

	const parsed = flowSchema.safeParse(proposal);
	if (!parsed.success) {
		const raw = proposal as { nodes?: unknown; edges?: unknown };
		return parsed.error.issues.map((issue) =>
			schemaIssue(raw, issue.path, issue.message),
		);
	}

	const profiles = options.profiles && [
		...options.profiles,
		...draft.nodes.flatMap(profilesOf),
	];
	const connections = options.connections && [
		...options.connections,
		...draft.nodes.flatMap(connectionsOf),
	];
	const { issues, validatorError } = checkDraft(parsed.data, messages, {
		flows: options.flows,
		name: options.name,
		profiles,
		connections,
		cliTools: options.cliTools,
		folder: options.folder,
	});
	if (validatorError !== null) {
		issues.push({
			severity: "error",
			message: `The flow could not be checked: ${validatorError}`,
		});
	}
	return issues;
}

const messages: DraftMessages = {
	// The proposal passed the schema before `checkDraft` runs.
	schemaIssue: (_flow, issue) => issue.message,
	missingConnection: (name) =>
		`This computer has no connection "${name}". Use one it has, or leave it out.`,
	missingProfile: (profile) =>
		`There is no profile "${profile.profile}" on the device "${profile.device}". Use a device and a profile from list_profiles.`,
	missingDevice: (id) =>
		`There is no device with the id "${id}". Use a device id from list_profiles, or leave device out.`,
	missingFlowDevice: () =>
		"The flow's list of devices names a device that is not in this Space. Use a device id from list_profiles.",
	programWithoutLogin: (program, tools) =>
		`The command calls ${program}, which runs without a login. Call ${tools.join(" or ")} instead: ${tools.length === 1 ? "that CLI tool runs" : "those CLI tools run"} ${program} signed in. list_tools names them.`,
	refusesCommands: (node, mode) =>
		`The Agent node "${node.id}" runs in ${mode}, which refuses shell commands such as git commit, except its CLI tools. Set permissionMode to "auto" if it must run commands.`,
	needsFolder: (need, node) => `${NO_FOLDER} ${folderNeedWords(need, node)}`,
};

/** What every folder need says first, for the agent. */
const NO_FOLDER =
	"This project has no folder: each run starts in an empty folder of its own, without git history or branches.";

/** What one folder need of a node says to the agent. */
function folderNeedWords(need: FolderNeed, node: FlowNode): string {
	switch (need.kind) {
		case "kit":
			return `The node "${node.id}" runs the kit "${need.kit}", which works in the project's folder, so it fails there. Leave it out.`;
		case "flow":
			return `The node "${node.id}" runs the flow "${need.flow}", which has a step that needs the project's folder, so that step fails.`;
		case "git":
			return `The command of the node "${node.id}" runs git in that empty folder, so it fails. Clone a repository first, or leave git out.`;
		case "branch":
			return `The node "${node.id}" reads run.${need.field}, which is always empty here.`;
	}
}

/** A schema issue, on its node or edge when it has one: `Node "build": prompt: …`. */
function schemaIssue(
	raw: { nodes?: unknown; edges?: unknown },
	path: readonly PropertyKey[],
	message: string,
): FlowIssue {
	const [scope, index, ...rest] = path;
	const where = rest.map(String).join(".");
	const tail = where === "" ? message : `${where}: ${message}`;
	if ((scope === "nodes" || scope === "edges") && typeof index === "number") {
		const list = scope === "nodes" ? raw.nodes : raw.edges;
		const item = Array.isArray(list) ? (list[index] as unknown) : undefined;
		const id =
			typeof item === "object" && item !== null
				? (item as { id?: unknown }).id
				: undefined;
		if (typeof id === "string") {
			return scope === "nodes"
				? { severity: "error", message: `Node "${id}": ${tail}`, nodeId: id }
				: { severity: "error", message: `Edge "${id}": ${tail}`, edgeId: id };
		}
	}
	const at = path.map(String).join(".");
	return {
		severity: "error",
		message: at === "" ? message : `${at}: ${message}`,
	};
}

function profilesOf(node: FlowNode): ProfileRef[] {
	return everyProfileOf(node).filter(isProfileRef);
}

function connectionsOf(node: FlowNode): string[] {
	if (node.type === "agent") return node.connections ?? [];
	if (node.type === "tool") return [node.connection];
	return [];
}

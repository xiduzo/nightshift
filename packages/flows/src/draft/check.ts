/** Checks a draft in its place: the schema, the connections, profiles, Devices and CLI programs it names, what needs the project's folder, and `validateFlow`. */
import { type Flow, type FlowNode, flowSchema } from "../flow";
import {
	type AgentNode,
	deviceIdOf,
	isProfileRef,
	type ProfileRef,
} from "../nodes";
import { everyProfileOf, profileOf, runsAs } from "../profiles";
import type { FlowIssue, ProjectFlowMap } from "../validate";
import { validateFlow } from "../validate";
import { type CliToolRef, programsWithoutLogin } from "./cli-programs";
import { type FolderNeed, folderNeeds } from "./folder";
import { missingConnections } from "./nodes";

export type FlowCheck = {
	issues: FlowIssue[];
	/** Set when the validator itself failed, so the issues are only the schema's. */
	validatorError: string | null;
};

/** One issue of the schema: where in the flow, and what the schema says. */
export type DraftSchemaIssue = {
	readonly path: readonly PropertyKey[];
	readonly message: string;
};

/** The words of a check. The app that shows the issues writes them. */
export type DraftMessages = {
	/** The message for one schema issue of the draft. */
	schemaIssue: (flow: Flow, issue: DraftSchemaIssue) => string;
	/** A connection the node names that this computer does not have. */
	missingConnection: (name: string) => string;
	/** A profile the node names that its Device does not have, as far as this computer knows. */
	missingProfile: (profile: ProfileRef) => string;
	/** A Device the node names (`device`) by an id that no Device of the list has. */
	missingDevice: (deviceId: string, node: FlowNode) => string;
	/** A Device in the flow's "Runs on" list by an id that no Device of the list has. */
	missingFlowDevice: () => string;
	/** A program a command calls by its own name, such as `acli`, that only `tools` sign in to. */
	programWithoutLogin: (program: string, tools: readonly string[]) => string;
	/**
	 * An Agent node that runs in a mode that refuses shell commands
	 * (`acceptEdits`, `default`): with nobody there to approve, it can only
	 * edit files and run its CLI tools. `git commit` fails.
	 */
	refusesCommands: (node: AgentNode, mode: CommandlessMode) => string;
	/** A node that needs the project's folder, in a project without one (`folderNeeds`). */
	needsFolder: (need: FolderNeed, node: FlowNode) => string;
};

/** The permission modes that refuse every shell command but the node's CLI tools in a run nobody watches. */
export type CommandlessMode = "acceptEdits" | "default";

/** A profile of a Device, with its permission mode when it is an Agent Profile and its Device tells it. */
export type PlaceProfile = {
	id: string;
	permissionMode?: AgentNode["permissionMode"];
};

/**
 * A Device a run of the project may use, with the profiles a node may
 * name on it. `profiles` is absent when this computer cannot tell them:
 * a profile on that Device is not checked.
 */
export type PlaceDevice = {
	deviceId: string;
	profiles?: readonly PlaceProfile[];
};

/**
 * The place a flow is checked in: what its project offers it. Each
 * runtime reads it its own way (the editor, the chat, `nightshift mcp`,
 * Suggest), and every check of a flow takes it whole, so one flow gets
 * the same issues at every door. Leave a fact out while it loads: the
 * checks that need it wait.
 */
export type FlowPlace = {
	/** The project's flow files by name, so Call nodes can check the flows they call. */
	flows?: ProjectFlowMap;
	/** The flow's own file name. The checked flow stands in for that file. */
	name?: string;
	/**
	 * The Devices a run of the project may use, as `SpaceEngine.listDevices`
	 * lists them: the person's own and those that offer profiles to the
	 * Space. A node that names another Device, or a profile none of them
	 * has, does not start.
	 */
	devices?: readonly PlaceDevice[];
	/** The names of the connections. */
	connections?: readonly string[];
	/** The CLI tools, to find a command that calls a program without its login. */
	cliTools?: readonly CliToolRef[];
	/**
	 * Whether the project has a folder (ADR 22). False: each step that
	 * needs one warns (`folderNeeds`).
	 */
	folder?: boolean;
};

/**
 * Checks the draft in its place: the schema first (what the API would
 * refuse to save), then what the place offers it (connections, profiles,
 * Devices, CLI tools, the folder), then `validateFlow` for meaning. Schema
 * issues point at their node or edge. With `flows`, Call nodes check the
 * flows they call, and a flow that reaches itself is reported with the
 * chain.
 */
export function checkDraft(
	flow: Flow,
	messages: DraftMessages,
	place: FlowPlace = {},
): FlowCheck {
	const { flows, name, connections, devices, cliTools, folder } = place;
	const issues: FlowIssue[] = [];
	const parsed = flowSchema.safeParse(flow);
	if (!parsed.success) {
		for (const issue of parsed.error.issues) {
			const [scope, index] = issue.path;
			const message = messages.schemaIssue(flow, issue);
			if (scope === "nodes" && typeof index === "number") {
				issues.push({
					severity: "error",
					message,
					nodeId: flow.nodes[index]?.id,
				});
			} else if (scope === "edges" && typeof index === "number") {
				issues.push({
					severity: "error",
					message,
					edgeId: flow.edges[index]?.id,
				});
			} else {
				issues.push({ severity: "error", message });
			}
		}
	}

	if (connections) {
		for (const node of flow.nodes) {
			for (const missing of missingConnections(node, connections)) {
				issues.push({
					severity: "error",
					message: messages.missingConnection(missing),
					nodeId: node.id,
				});
			}
		}
	}

	if (devices) {
		for (const node of flow.nodes) {
			// A name left from format 6: `validateFlow` asks to pick it again.
			for (const profile of everyProfileOf(node).filter(isProfileRef)) {
				if (profileIn(devices, profile) !== undefined) continue;
				issues.push({
					severity: "error",
					message: messages.missingProfile(profile),
					nodeId: node.id,
				});
			}
		}
	}

	for (const node of flow.nodes) {
		if (node.type !== "agent") continue;
		const mode = commandlessMode(node, devices);
		if (mode === null) continue;
		issues.push({
			severity: "warning",
			message: messages.refusesCommands(node, mode),
			nodeId: node.id,
		});
	}

	if (devices) {
		const known = (id: string) =>
			devices.some((device) => device.deviceId === id);
		for (const id of flow.devices ?? []) {
			if (known(id)) continue;
			issues.push({ severity: "error", message: messages.missingFlowDevice() });
		}
		for (const node of flow.nodes) {
			const id = "device" in node ? deviceIdOf(node.device) : undefined;
			if (id === undefined || known(id)) continue;
			issues.push({
				severity: "error",
				message: messages.missingDevice(id, node),
				nodeId: node.id,
			});
		}
	}

	if (cliTools) {
		// A warning: the program may be signed in on its own on this computer.
		for (const node of flow.nodes) {
			for (const { program, tools } of programsWithoutLogin(node, cliTools)) {
				issues.push({
					severity: "warning",
					message: messages.programWithoutLogin(program, tools),
					nodeId: node.id,
				});
			}
		}
	}

	let validatorError: string | null = null;
	try {
		issues.push(...validateFlow(flow, flows ? { flows, name } : undefined));
		if (folder === false)
			issues.push(...folderIssues(flow, messages, flows, name));
	} catch (error) {
		validatorError = error instanceof Error ? error.message : String(error);
	}
	return { issues, validatorError };
}

/**
 * The profile `ref` names, as the place's Devices tell it: `"untold"`
 * when its Device does not tell its profiles, undefined when no Device
 * has it.
 */
function profileIn(
	devices: readonly PlaceDevice[],
	ref: ProfileRef,
): PlaceProfile | "untold" | undefined {
	const device = devices.find((known) => known.deviceId === ref.device);
	if (device && device.profiles === undefined) return "untold";
	return device?.profiles?.find((profile) => profile.id === ref.profile);
}

/**
 * A warning on each node that needs the project's folder (`folderNeeds`):
 * the step fails, or reads nothing, only when a run reaches it.
 */
function folderIssues(
	flow: Flow,
	messages: DraftMessages,
	flows: ProjectFlowMap | undefined,
	name: string | undefined,
): FlowIssue[] {
	const nodes = new Map(flow.nodes.map((node) => [node.id, node]));
	return folderNeeds(flow, { flows, name }).flatMap(({ nodeId, need }) => {
		const node = nodes.get(nodeId);
		return node
			? [
					{
						severity: "warning" as const,
						message: messages.needsFolder(need, node),
						nodeId,
					},
				]
			: [];
	});
}

/**
 * The mode that refuses commands that the Agent node, or one of its
 * cascade's tiers, runs in: its own permission mode, else its profile's
 * as its Device tells it. Null when it runs in another mode, or when the
 * profile's mode is not known.
 */
function commandlessMode(
	node: AgentNode,
	devices: readonly PlaceDevice[] | undefined,
): CommandlessMode | null {
	for (const run of runsAs(node)) {
		if (run.type !== "agent") continue;
		const profile = profileOf(run);
		const known =
			devices && profile !== undefined && isProfileRef(profile)
				? profileIn(devices, profile)
				: undefined;
		const mode =
			run.permissionMode ??
			node.permissionMode ??
			(typeof known === "object" ? known.permissionMode : undefined);
		if (mode === "acceptEdits" || mode === "default") return mode;
	}
	return null;
}

/** Whether the draft passes the schema, so `flows.save` accepts it. */
export function isSavable(flow: Flow): boolean {
	return flowSchema.safeParse(flow).success;
}

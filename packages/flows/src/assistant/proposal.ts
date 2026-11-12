/**
 * What "valid" means for a flow an agent writes. The chat's `propose_flow`
 * and `check_flow`, `nightshift mcp`, Suggest and the docs script ask this
 * one function. It checks in the place the editor checks in, so the agent
 * and the person see the same issues.
 */

import {
	checkDraft,
	type DraftMessages,
	type FlowPlace,
	type FolderNeed,
	type PlaceDevice,
} from "../draft";
import { FLOW_VERSION, type Flow, type FlowNode, flowSchema } from "../flow";
import { deviceIdOf, isProfileRef } from "../nodes";
import { everyProfileOf } from "../profiles";
import type { FlowIssue } from "../validate";

/**
 * The issues of `proposal`, a new version of `draft`, in the place the
 * flow is checked in: the flow schema first, then the same checks as the
 * editor (`checkDraft`, `validateFlow`).
 *
 * A profile, a connection or a Device the proposal names that the place
 * does not have is an error, so the assistant does not invent one. A name
 * the draft already uses is left to the editor's own check: the person
 * put it there.
 *
 * `proposal` is what the agent wrote, not yet read by the schema. A flow with
 * no `error` issue reads with `flowSchema.parse(proposal)`.
 */
export function proposalIssues(
	draft: Flow,
	proposal: unknown,
	place: FlowPlace = {},
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

	const { issues, validatorError } = checkDraft(
		parsed.data,
		messages,
		withNamesOf(draft, place),
	);
	if (validatorError !== null) {
		issues.push({
			severity: "error",
			message: `The flow could not be checked: ${validatorError}`,
		});
	}
	return issues;
}

/**
 * The place with what `draft` names already: its connections, and its
 * profiles and Devices on the place's Devices. A Device that does not
 * tell its profiles stays so.
 */
function withNamesOf(draft: Flow, place: FlowPlace): FlowPlace {
	const { connections, devices } = place;
	return {
		...place,
		...(connections && {
			connections: [...connections, ...draft.nodes.flatMap(connectionsOf)],
		}),
		...(devices && { devices: withDevicesOf(draft, devices) }),
	};
}

/** The Devices with the profiles and Device ids `draft` names added. */
function withDevicesOf(
	draft: Flow,
	devices: readonly PlaceDevice[],
): PlaceDevice[] {
	const named = new Map<string, string[]>();
	const name = (deviceId: string, profile?: string) => {
		const profiles = named.get(deviceId) ?? [];
		if (profile !== undefined) profiles.push(profile);
		named.set(deviceId, profiles);
	};
	for (const node of draft.nodes) {
		for (const ref of everyProfileOf(node).filter(isProfileRef)) {
			name(ref.device, ref.profile);
		}
		const id = "device" in node ? deviceIdOf(node.device) : undefined;
		if (id !== undefined) name(id);
	}
	for (const id of draft.devices ?? []) name(id);
	const added = (ids: string[]) => ids.map((id) => ({ id }));
	return [
		...devices.map((device) => {
			const ids = named.get(device.deviceId);
			return ids && device.profiles
				? { ...device, profiles: [...device.profiles, ...added(ids)] }
				: device;
		}),
		...[...named]
			.filter(([id]) => !devices.some((device) => device.deviceId === id))
			.map(([deviceId, ids]) => ({ deviceId, profiles: added(ids) })),
	];
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

function connectionsOf(node: FlowNode): string[] {
	if (node.type === "agent") return node.connections ?? [];
	if (node.type === "tool") return [node.connection];
	return [];
}

/** Checks a draft: the schema, the connections and profiles it names, and `validateFlow`. */
import { type Flow, flowSchema } from "../flow";
import { isProfileRef, type ProfileRef, sameProfileRef } from "../nodes";
import { profileOf } from "../profiles";
import type { FlowIssue, ProjectFlowMap } from "../validate";
import { validateFlow } from "../validate";
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
};

export type DraftCheckOptions = {
	/** The project's flow files by name, so Call nodes can check the flows they call. */
	flows?: ProjectFlowMap;
	/** The draft's own file name. The draft stands in for that file. */
	name?: string;
	/** The names of the connections. Leave it out while they load. */
	connections?: readonly string[];
	/**
	 * The profiles a node may name: each Device's that this computer knows
	 * of. Leave it out while they load.
	 */
	profiles?: readonly ProfileRef[];
	/** The Devices whose profiles this computer cannot tell: a profile on one is not checked. */
	untoldDevices?: readonly string[];
};

/**
 * Checks the draft: the schema first (what the API would refuse to save), then
 * `validateFlow` for meaning. Schema issues point at their node or edge.
 * With `flows`, Call nodes check the flows they call, and a flow that reaches
 * itself is reported with the chain.
 */
export function checkDraft(
	flow: Flow,
	messages: DraftMessages,
	{ flows, name, connections, profiles, untoldDevices }: DraftCheckOptions = {},
): FlowCheck {
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

	if (profiles) {
		for (const node of flow.nodes) {
			const profile = profileOf(node);
			// A name left from format 6: `validateFlow` asks to pick it again.
			if (!isProfileRef(profile)) continue;
			if (untoldDevices?.includes(profile.device)) continue;
			if (profiles.some((known) => sameProfileRef(known, profile))) continue;
			issues.push({
				severity: "error",
				message: messages.missingProfile(profile),
				nodeId: node.id,
			});
		}
	}

	let validatorError: string | null = null;
	try {
		issues.push(...validateFlow(flow, flows ? { flows, name } : undefined));
	} catch (error) {
		validatorError = error instanceof Error ? error.message : String(error);
	}
	return { issues, validatorError };
}

/** Whether the draft passes the schema, so `flows.save` accepts it. */
export function isSavable(flow: Flow): boolean {
	return flowSchema.safeParse(flow).success;
}

import {
	type Flow,
	type FlowInput,
	flowSchema,
	type NodeFamily,
} from "../flow";
import { calledFlowNames, kitNameSchema } from "../nodes";
import { emailSendKit } from "./email/send";
import { feedsReadKit } from "./feeds/read";
import { createBranchKit } from "./github/create-branch";
import { finishPrKit } from "./github/finish-pr";
import { publishDraftPrKit } from "./github/publish-draft-pr";
import { waitForChecksKit } from "./github/wait-for-checks";
import { watchPrKit } from "./github/watch-pr";
import { jiraAssignKit } from "./jira/assign";
import { jiraMoveKit } from "./jira/move";
import { knowledgeReviewLearningsKit } from "./knowledge/review-learnings";
import { KNOWLEDGE_SYNC_KITS } from "./knowledge/source-kits";
import { messageSendKit } from "./message/send";

/**
 * Kits: flows that ship with Night Shift, read only. A Call node runs one
 * by name, `"flow": "kit:github/publish-draft-pr"`, as it runs a flow of
 * the project. Each is plain nodes: Commands on a command-line tool a
 * person has (git, `gh`, `acli`, `curl`), or Web requests and the nodes
 * that shape their data. So the engine knows no tracker and no vendor, and
 * a kit runs on any Device that has those tools and is signed in. The
 * `knowledge/*` kits fill the project's knowledge folder (`$NS_KNOWLEDGE`).
 * A person can copy a kit into the project and change it there
 * (`kitCopyName`).
 */

/** What every kit name starts with. */
export const KIT_PREFIX = "kit:";

/**
 * One kit as the registry holds it: its flow as its file would hold it,
 * and its family, the role a node type of that family has (`NODE_FAMILY`).
 * The family lives here, not in the flow format: a copy in a project is a
 * plain flow.
 */
type KitSource = { flow: FlowInput; family: NodeFamily };

/** The kits by name. */
const SOURCES: Readonly<Record<string, KitSource>> = {
	"kit:github/create-branch": { flow: createBranchKit, family: "do" },
	"kit:github/publish-draft-pr": { flow: publishDraftPrKit, family: "do" },
	"kit:github/finish-pr": { flow: finishPrKit, family: "do" },
	"kit:github/wait-for-checks": { flow: waitForChecksKit, family: "hold" },
	"kit:github/watch-pr": { flow: watchPrKit, family: "hold" },
	"kit:jira/assign": { flow: jiraAssignKit, family: "do" },
	"kit:jira/move": { flow: jiraMoveKit, family: "do" },
	"kit:message/send": { flow: messageSendKit, family: "do" },
	"kit:feeds/read": { flow: feedsReadKit, family: "do" },
	"kit:email/send": { flow: emailSendKit, family: "do" },
	"kit:knowledge/review-learnings": {
		flow: knowledgeReviewLearningsKit,
		family: "decide",
	},
	...Object.fromEntries(
		KNOWLEDGE_SYNC_KITS.map(({ kit, flow }) => [kit, { flow, family: "do" }]),
	),
};

/** One kit: its name, its flow and its family. */
export type Kit = { name: string; flow: Flow; family: NodeFamily };

/** The kits, parsed once on first use. */
let parsed: ReadonlyMap<string, Kit> | undefined;

function kits(): ReadonlyMap<string, Kit> {
	parsed ??= new Map(
		Object.entries(SOURCES).map(([name, { flow, family }]) => [
			name,
			{ name, flow: flowSchema.parse(flow), family },
		]),
	);
	return parsed;
}

/** Whether a Call's flow names a kit (`kit:…`), known or not. */
export function isKitName(name: string): boolean {
	return name.startsWith(KIT_PREFIX);
}

/** The flow of a kit, by its name. Undefined for a name that is not a kit. */
export function kitFlow(name: string): Flow | undefined {
	return kits().get(name)?.flow;
}

/** Every kit, sorted by name. */
export function kitList(): Kit[] {
	return [...kits().values()].sort((a, b) =>
		a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
	);
}

/**
 * The flow file name a copy of a kit takes in the project:
 * `kit:github/publish-draft-pr` becomes `github-publish-draft-pr`. Null for
 * a name that is not a valid kit name.
 */
export function kitCopyName(name: string): string | null {
	if (!kitNameSchema.safeParse(name).success) return null;
	return name.slice(KIT_PREFIX.length).replace("/", "-");
}

/** What the knowledge kits' names start with. */
const KNOWLEDGE_KITS = `${KIT_PREFIX}knowledge/`;

/** The kit that asks a person about the learnings agents proposed. */
export const REVIEW_LEARNINGS_KIT = `${KNOWLEDGE_KITS}review-learnings`;

/** Whether a Call's flow names a `kit:knowledge/*` kit, known or not. */
export function isKnowledgeKit(name: string): boolean {
	return name.startsWith(KNOWLEDGE_KITS);
}

/**
 * The knowledge kits a flow calls, by name, sorted: a flow with one fills
 * the project's knowledge (or reviews its learnings,
 * `REVIEW_LEARNINGS_KIT`), and the Knowledge page offers to run it.
 */
export function knowledgeKitsOf(flow: Flow): string[] {
	const names = new Set<string>();
	for (const node of flow.nodes) {
		if (node.type !== "call") continue;
		for (const name of calledFlowNames(node)) {
			if (isKnowledgeKit(name)) names.add(name);
		}
	}
	return [...names].sort();
}

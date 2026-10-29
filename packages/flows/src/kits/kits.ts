import { type Flow, type FlowInput, flowSchema } from "../flow";
import { kitNameSchema } from "../nodes";
import { createBranchKit } from "./github/create-branch";
import { finishPrKit } from "./github/finish-pr";
import { publishDraftPrKit } from "./github/publish-draft-pr";
import { waitForChecksKit } from "./github/wait-for-checks";
import { jiraAssignKit } from "./jira/assign";
import { jiraMoveKit } from "./jira/move";

/**
 * Kits: flows that ship with Night Shift, read only. A Call node runs one
 * by name, `"flow": "kit:github/publish-draft-pr"`, as it runs a flow of
 * the project. Each is plain Commands on a command-line tool a person has
 * (git, `gh`, `acli`), so the engine knows no tracker, and a kit runs on
 * any Device that has those tools and is signed in. A person can copy a
 * kit into the project and change it there (`kitCopyName`).
 */

/** What every kit name starts with. */
export const KIT_PREFIX = "kit:";

/** The kits by name, as their files would hold them. */
const SOURCES: Readonly<Record<string, FlowInput>> = {
	"kit:github/create-branch": createBranchKit,
	"kit:github/publish-draft-pr": publishDraftPrKit,
	"kit:github/finish-pr": finishPrKit,
	"kit:github/wait-for-checks": waitForChecksKit,
	"kit:jira/assign": jiraAssignKit,
	"kit:jira/move": jiraMoveKit,
};

/** One kit: its name and its flow. */
export type Kit = { name: string; flow: Flow };

/** The kits, parsed once on first use. */
let parsed: ReadonlyMap<string, Flow> | undefined;

function kits(): ReadonlyMap<string, Flow> {
	parsed ??= new Map(
		Object.entries(SOURCES).map(([name, source]) => [
			name,
			flowSchema.parse(source),
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
	return kits().get(name);
}

/** Every kit, sorted by name. */
export function kitList(): Kit[] {
	return [...kits()]
		.map(([name, flow]) => ({ name, flow }))
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
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

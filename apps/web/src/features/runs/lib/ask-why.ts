import type { RunStatus } from "@/shared/api";

/** The run statuses an agent can explain: the run ended before its end. */
const ENDED_EARLY: ReadonlySet<RunStatus> = new Set([
	"failed",
	"stopped",
	"interrupted",
]);

/**
 * Whether "Ask an agent why" shows for a run, and if it works:
 * - `hidden`: the run did not end early, it has no flow file, or its
 *   project is not in the Space you work in.
 * - `disabled`: it shows with the reason it cannot work here.
 * - `ready`: it opens the run's flow with a chat about the run.
 */
export type AskWhy =
	| { kind: "hidden" }
	| { kind: "disabled"; reason: string }
	| { kind: "ready"; projectId: string; flowName: string };

export function askWhy({
	status,
	flowName,
	project,
	owner,
}: {
	status: RunStatus;
	/** The flow the run ran, or null for a run without a flow file. */
	flowName: string | null;
	/** The run's project in the Space you work in, or undefined when it is not there. */
	project: { id: string; repoPath: string | null } | undefined;
	/** You own this computer. Undefined while that loads. */
	owner: boolean | undefined;
}): AskWhy {
	if (!ENDED_EARLY.has(status) || flowName === null || !project)
		return { kind: "hidden" };
	if (owner === false)
		return {
			kind: "disabled",
			reason: "Only the owner of this computer can ask an agent here.",
		};
	if (project.repoPath === null)
		return {
			kind: "disabled",
			reason:
				"This project is not on this computer. Open the run on a computer that has it.",
		};
	if (owner === undefined) return { kind: "hidden" };
	return { kind: "ready", projectId: project.id, flowName };
}

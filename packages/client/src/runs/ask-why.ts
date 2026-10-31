import { endedEarly } from "@nightshift/engine/run-status";

import type { RunStatus } from "./types";

/**
 * "Ask an agent why" on the desktop, and if it works:
 * - `hidden`: the run did not end early, it has no flow file, or its
 *   project is not in the Space you work in.
 * - `disabled`: it shows with the reason it cannot work here.
 * - `ready`: it opens the run's flow with a chat about the run.
 */
export type AskWhy =
	| { kind: "hidden" }
	| { kind: "disabled"; reason: string }
	| { kind: "ready"; projectId: string; flowName: string };

/**
 * The chat about the run runs on this computer's own profiles, in its copy
 * of the project, and may propose a change to the flow: only for the owner
 * of this computer, for a run of a flow file of a project here.
 */
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
	if (!endedEarly(status) || flowName === null || !project)
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

/**
 * "Ask why" on the phone: one answer, no chat, from the computer the phone
 * talks to (`assistant.explain`). It needs no flow file, no copy of the
 * project here and no ownership, so it shows for every run that ended
 * early. Your role decides on the server: a viewer gets a refusal.
 */
export function askWhyAnswer(status: RunStatus): boolean {
	return endedEarly(status);
}

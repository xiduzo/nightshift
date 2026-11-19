import type { Permissions, RoleRefusal } from "@nightshift/auth";
import type { Actor } from "../../../contract";
import type { RunRow } from "../../../log";
import { RunNotFound } from "../domain/refusals";
import type { RunRecords, SpaceMembers } from "./ports";

/** A run as access gives it: the run's row of the log, under the slice's name. */
export type RunRecord = RunRow;

export type OpenRunPorts = {
	runs: RunRecords;
	members: Pick<SpaceMembers, "may">;
	/**
	 * The refusal of a role that does not allow the request: `RoleRefusal`
	 * of `@nightshift/auth`, the owner of roles. It comes in here because a
	 * use case imports only types of another package.
	 */
	RoleRefusal: typeof RoleRefusal;
};

/** Which run, in which Space when the caller holds one, and what the actor needs to do there. */
export type OpenRun = {
	runId: string;
	/** The Space the caller works in. A run of another Space is not found. */
	spaceId?: string;
	/** What the Person's role must allow. Absent: being a Member is enough. */
	need?: Permissions;
};

/** The run, and whether this computer walks it now. */
export type OpenedRun = { run: RunRecord; walkedHere: boolean };

/**
 * Opens a run for the actor: the one check of who may see or act on a
 * run. A run this Replica does not have, a run of another Space than the
 * one asked for, and a run of a Space the Person is not a Member of are
 * not found (`RunNotFound`). A Person whose role does not allow `need` is
 * refused (`RoleRefusal`). Night Shift itself may open every run.
 */
export const openRun =
	(ports: OpenRunPorts) =>
	async (actor: Actor, request: OpenRun): Promise<OpenedRun> => {
		const { runs, members } = ports;
		const run = await runs.find(request.runId);
		if (
			!run ||
			(request.spaceId !== undefined && run.spaceId !== request.spaceId)
		) {
			throw new RunNotFound();
		}
		if ("personId" in actor) {
			const may = await members.may(run.spaceId, actor, request.need ?? {});
			if (may === "not-a-member") throw new RunNotFound();
			if (may === "no") throw new ports.RoleRefusal();
		}
		return { run, walkedHere: await runs.walkedHere(run) };
	};

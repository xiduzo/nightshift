import type { MemberChange } from "../contract";
import type { RunLog } from "./run-log";

/**
 * Logs a change of a Space's Members in that Space's event log
 * (`MemberJoined`, `MemberRemoved`, `MemberRoleChanged`), with who made it.
 */
export async function logMemberChange(
	log: RunLog,
	change: MemberChange,
): Promise<void> {
	const { spaceId, personId, by } = change;
	if (change.kind === "joined") {
		await log.append({
			type: "MemberJoined",
			spaceId,
			payload: {
				personId,
				role: change.role,
				by,
				...(change.invitedBy ? { invitedBy: change.invitedBy } : {}),
			},
		});
	} else if (change.kind === "removed") {
		await log.append({
			type: "MemberRemoved",
			spaceId,
			payload: { personId, by },
		});
	} else {
		await log.append({
			type: "MemberRoleChanged",
			spaceId,
			payload: {
				personId,
				role: change.role,
				previousRole: change.previousRole,
				by,
			},
		});
	}
}

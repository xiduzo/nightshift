import type { LeaveResult } from "../../contract";
import type { HomeMembership } from "./create-home-membership";

/** This computer leaves its home Host and Personal splits off. */
export function leaveHost(membership: Pick<HomeMembership, "leave">) {
	return (): Promise<LeaveResult> => membership.leave();
}

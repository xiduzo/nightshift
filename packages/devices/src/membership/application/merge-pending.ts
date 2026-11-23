import type { MergePending } from "../../contract";
import type { HomeMembership } from "./create-home-membership";

/** Whether Personal waits to merge, without calling the Host. */
export function mergePending(membership: Pick<HomeMembership, "pending">) {
	return (): Promise<MergePending> => membership.pending();
}

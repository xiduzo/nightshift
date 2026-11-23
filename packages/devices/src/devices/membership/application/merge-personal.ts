import type { MergeResult } from "../../../contract";
import type { HomeMembership } from "./create-home-membership";

/** Merges Personal into the home Host's, or goes on with a merge that stopped. */
export function mergePersonal(membership: Pick<HomeMembership, "merge">) {
	return (input: { join?: readonly string[] } = {}): Promise<MergeResult> =>
		membership.merge(input);
}

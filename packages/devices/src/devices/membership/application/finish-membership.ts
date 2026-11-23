import type { SplitResult } from "../../../contract";
import type { HostRole } from "../../../links";
import type { HomeMembership } from "./create-home-membership";

/**
 * Goes on with a split or a merge that moved its rows: the timer and a
 * Host revoke call this.
 */
export function finishMembership(
	membership: Pick<HomeMembership, "revoked" | "keepFinishing">,
) {
	return {
		revoked(link: { role: HostRole }): Promise<SplitResult | null> {
			return membership.revoked(link);
		},
		keepFinishing(signal: AbortSignal, everyMs?: number): void {
			membership.keepFinishing(signal, everyMs);
		},
	};
}

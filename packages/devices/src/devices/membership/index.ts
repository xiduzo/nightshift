/**
 * This computer's membership of its home Host (ADR 1), as one state
 * machine: the merge of its own personal Space into its Person's personal
 * Space on that Host when it joins, and the split of a personal Space of
 * its own when it leaves or loses its access.
 */

export type { HomeMembership } from "./application/create-home-membership";
export { wireMembership } from "./wire";

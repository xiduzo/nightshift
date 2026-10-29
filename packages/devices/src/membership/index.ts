/**
 * This computer's membership of its home Host (ADR 1), as one state
 * machine: the merge of its own personal Space into its Person's personal
 * Space on that Host when it joins, and the split of a personal Space of
 * its own when it leaves or loses its access. One step at a time, each
 * with a copy of the database first and states a crash cannot leave half
 * done (`space_merge`, `space_split`).
 */

export { createHomeMembership, type HomeMembership } from "./membership";

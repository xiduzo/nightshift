/**
 * The merge of this computer's own personal Space into its Person's
 * personal Space on its home Host (ADR 1): checks, a preview that changes
 * nothing, a copy of the database first, and states a crash cannot leave
 * half done (`space_merge`). And its reverse when this computer leaves
 * that Host: the split of a personal Space of its own (`space_split`).
 */

export { mergeOnJoin } from "./on-join";
export {
	createPersonalMerge,
	type MergeMove,
	type PersonalSpaceMerge,
} from "./personal-merge";
export { createPersonalSplit } from "./split";

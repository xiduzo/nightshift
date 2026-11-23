import type { MergePreview } from "../../../contract";
import type { HomeMembership } from "./create-home-membership";

/** What a merge would do now. Changes nothing. */
export function previewMerge(membership: Pick<HomeMembership, "preview">) {
	return (input: { join?: readonly string[] } = {}): Promise<MergePreview> =>
		membership.preview(input);
}

import type { SourceItem } from "@nightshift/flows";
import type { GithubItemsInput } from "./types";

/**
 * Reads the sub-issues of one parent issue as For Each items, with their
 * "blocked by" links (and whether each blocker is closed). Items come in
 * GitHub's sub-issue order; the engine orders them blockers first. A
 * sub-issue without `requireLabel` is left out. Closed sub-issues and those
 * with a done label are `done`. Pages through all sub-issues.
 */
export async function readGithubItems(
	input: GithubItemsInput,
	options?: { gh?: string; env?: Record<string, string> },
): Promise<SourceItem[]> {
	throw new Error("Not implemented");
}

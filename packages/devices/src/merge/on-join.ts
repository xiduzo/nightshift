import { FAILURE_MESSAGE, Refusal } from "@nightshift/refusal";
import type { DeviceLinks, HostSpaces, JoinProgress } from "../links";
import { MERGE_WORDS, type PersonalSpaceMerge } from "./personal-merge";

/** How long a new join waits for its home Host to list the personal Space. */
const LISTED_WAIT_MS = 30_000;

/**
 * Merge on join (ADR 1): once this computer paired with its home Host,
 * its Personal merges into the Host's, and the join shows how. It waits
 * for the new link to answer and list the personal Space, shows the
 * preview, then merges. A merge that cannot run now ends the join with
 * the reason: the join itself stands, and the merge waits for the person
 * (`merge-skipped`). Nothing to merge: nothing more.
 */
export async function* mergeOnJoin(
	deps: {
		merge: Pick<PersonalSpaceMerge, "preview" | "run">;
		links: Pick<DeviceLinks, "get">;
		hostSpaces: Pick<HostSpaces, "listed">;
		/** How long to wait for the Host's list. Default 30 s. */
		waitMs?: number;
	},
	hostId: string,
	signal?: AbortSignal,
): AsyncGenerator<JoinProgress> {
	const end = Date.now() + (deps.waitMs ?? LISTED_WAIT_MS);
	while (Date.now() < end && !signal?.aborted) {
		const link = deps.links.get(hostId);
		const listed = await deps.hostSpaces.listed(hostId);
		if (
			link?.state().status === "online" &&
			listed.some((space) => space.personal)
		) {
			break;
		}
		await Bun.sleep(200);
	}
	try {
		const preview = await deps.merge.preview();
		yield { kind: "merge-preview", preview };
		const result = await deps.merge.run();
		yield { kind: "merged", result };
	} catch (error) {
		if (error instanceof Refusal && error.message === MERGE_WORDS.merged) {
			return;
		}
		if (!(error instanceof Refusal)) {
			console.error("[devices] the merge on join failed:", error);
		}
		yield {
			kind: "merge-skipped",
			reason: error instanceof Refusal ? error.message : FAILURE_MESSAGE,
		};
	}
}

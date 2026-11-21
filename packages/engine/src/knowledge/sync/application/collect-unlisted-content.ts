import { CONTENT_GRACE_MS, type CollectResult } from "../domain/collect";
import type {
	ContentArchive,
	KnowledgeDocuments,
	ProjectSpaces,
	SpaceHosts,
} from "./ports";

export type CollectUnlistedContentPorts = {
	archive: Pick<ContentArchive, "here">;
	documents: Pick<KnowledgeDocuments, "open">;
	spaces: Pick<ProjectSpaces, "projectsIn">;
	/** Whether this Replica keeps the Space: it is its Host, or it has no Host. */
	hosts: Required<Pick<SpaceHosts, "keeps">>;
	now: () => number;
	/** Default `CONTENT_GRACE_MS`. */
	graceMs?: number;
};

/**
 * Removes the knowledge content of the Spaces this Replica keeps that no
 * document lists (`domain/collect.ts`). The timer of Night Shift asks it
 * once a day.
 */
export const collectUnlistedContent =
	(ports: CollectUnlistedContentPorts) => async (): Promise<CollectResult> => {
		const now = ports.now();
		const keptBefore = now - (ports.graceMs ?? CONTENT_GRACE_MS);
		const result: CollectResult = { removed: 0, waiting: 0 };
		const bySpace = new Map<string, { sha256: string; keptAt: number }[]>();
		for (const kept of await ports.archive.here.contents()) {
			const list = bySpace.get(kept.spaceId) ?? [];
			list.push(kept);
			bySpace.set(kept.spaceId, list);
		}
		for (const [spaceId, contents] of bySpace) {
			if (!(await ports.hosts.keeps(spaceId))) continue;
			const listed = await listedIn(ports, spaceId);
			for (const { sha256, keptAt } of contents) {
				if (listed.has(sha256)) continue;
				if (keptAt >= keptBefore) {
					result.waiting++;
					continue;
				}
				const ref = { kind: "content" as const, spaceId, sha256 };
				if (await ports.archive.here.drop(ref, { keptBefore })) {
					result.removed++;
				}
			}
		}
		return result;
	};

/**
 * Every hash the knowledge documents of the Space's Projects name, a
 * removed Project's too, and an entry no reconcile reads (a path that is
 * no knowledge, a value of another version): what any Replica may still
 * fetch stays. Read after the archive's list: content kept since is
 * younger than the grace period.
 */
async function listedIn(
	ports: Pick<CollectUnlistedContentPorts, "spaces" | "documents">,
	spaceId: string,
): Promise<Set<string>> {
	const listed = new Set<string>();
	for (const id of await ports.spaces.projectsIn(spaceId)) {
		for (const sha256 of (await ports.documents.open(id)).allHashes()) {
			listed.add(sha256);
		}
	}
	return listed;
}

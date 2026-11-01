import type { Database } from "@nightshift/db";
import { project } from "@nightshift/db/schema";
import { now as timeNow } from "@nightshift/time";
import { eq } from "drizzle-orm";
import type { SpaceArchive } from "../archive";
import { type KnowledgeDocuments, knowledgeFiles } from "./knowledge-document";

/**
 * The collection of knowledge content that no document lists any more
 * (ADR 4, "Consequences"): a sync replaces its folder, and each change
 * of a file leaves its earlier content in the archive.
 *
 * It runs on the Replica that keeps a Space: its archive is the one the
 * Devices copy to. A Device's own cache is left alone. Content goes only
 * when no knowledge document of any Project of its Space lists it, and
 * when it was last kept longer ago than the grace period: a Device copies
 * content to the Host before its entry reaches the Host's document, and a
 * Device that goes offline in between may bring the entry days later.
 */

/** How long unlisted content stays after it was last kept. */
export const CONTENT_GRACE_MS = 7 * 24 * 60 * 60_000;

/** What one collection did. */
export type CollectResult = {
	/** Content files it removed. */
	removed: number;
	/** Unlisted content it kept for now: within the grace period. */
	waiting: number;
};

export type CollectDeps = {
	db: Database;
	documents: Pick<KnowledgeDocuments, "open">;
	archive: Pick<SpaceArchive, "here">;
	/** Whether this Replica keeps the Space: it is its Host, or it has no Host. */
	keeps(spaceId: string): Promise<boolean>;
	now?: () => number;
	/** Default `CONTENT_GRACE_MS`. */
	graceMs?: number;
};

/** Removes the knowledge content of the Spaces this Replica keeps that no document lists. */
export async function collectContent(
	deps: CollectDeps,
): Promise<CollectResult> {
	const now = deps.now?.() ?? timeNow();
	const keptBefore = now - (deps.graceMs ?? CONTENT_GRACE_MS);
	const result: CollectResult = { removed: 0, waiting: 0 };
	const bySpace = new Map<string, { sha256: string; keptAt: number }[]>();
	for (const kept of await deps.archive.here.contents()) {
		const list = bySpace.get(kept.spaceId) ?? [];
		list.push(kept);
		bySpace.set(kept.spaceId, list);
	}
	for (const [spaceId, contents] of bySpace) {
		if (!(await deps.keeps(spaceId))) continue;
		const listed = await listedIn(deps, spaceId);
		for (const { sha256, keptAt } of contents) {
			if (listed.has(sha256)) continue;
			if (keptAt >= keptBefore) {
				result.waiting++;
				continue;
			}
			const ref = { kind: "content" as const, spaceId, sha256 };
			if (await deps.archive.here.drop(ref, { keptBefore })) result.removed++;
		}
	}
	return result;
}

/**
 * Every hash the knowledge documents of the Space's Projects name, a
 * removed Project's too, and an entry no reconcile reads (a path that is
 * no knowledge, a value of another version): what any Replica may still
 * fetch stays. Read after the archive's list: content kept since is
 * younger than the grace period.
 */
async function listedIn(
	deps: Pick<CollectDeps, "db" | "documents">,
	spaceId: string,
): Promise<Set<string>> {
	const rows = await deps.db
		.select({ id: project.id })
		.from(project)
		.where(eq(project.spaceId, spaceId));
	const listed = new Set<string>();
	for (const { id } of rows) {
		for (const value of knowledgeFiles(
			await deps.documents.open(id),
		).values()) {
			const sha256 = (value as { sha256?: unknown } | null)?.sha256;
			if (typeof sha256 === "string") listed.add(sha256);
		}
	}
	return listed;
}

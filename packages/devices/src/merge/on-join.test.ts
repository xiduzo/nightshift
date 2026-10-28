import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import type { MergePreview, MergeResult } from "../contract";
import type { JoinProgress, Link } from "../links";
import { mergeOnJoin } from "./on-join";
import { MERGE_WORDS } from "./personal-merge";

/** Merge on join: after a home Host, the join shows the merge of Personal. */

const preview: MergePreview = {
	host: { id: "host", name: "A" },
	projects: [],
	runs: 0,
};
const result: MergeResult = {
	state: "pushed",
	projects: 0,
	runs: 0,
	backup: "/data/backups/copy.db",
};
const onlineLink = {
	state: () => ({ status: "online", address: "memory", since: 0 }),
} as unknown as Link;

async function steps(merge: {
	preview(): Promise<MergePreview>;
	run(): Promise<MergeResult>;
}): Promise<JoinProgress[]> {
	const seen: JoinProgress[] = [];
	for await (const step of mergeOnJoin(
		{
			merge,
			links: { get: () => onlineLink },
			hostSpaces: {
				listed: async () => [
					{ id: "s", name: "Personal on A", personal: true },
				],
			},
			waitMs: 100,
		},
		"host",
	)) {
		seen.push(step);
	}
	return seen;
}

describe("mergeOnJoin", () => {
	test("shows what the merge does, then how it went", async () => {
		expect(
			await steps({ preview: async () => preview, run: async () => result }),
		).toEqual([
			{ kind: "merge-preview", preview },
			{ kind: "merged", result },
		]);
	});

	test("a merge that cannot run now says why, and the join stands", async () => {
		const refused = async (): Promise<never> => {
			throw new Refusal("conflict", MERGE_WORDS.isHost);
		};
		expect(await steps({ preview: refused, run: refused })).toEqual([
			{ kind: "merge-skipped", reason: MERGE_WORDS.isHost },
		]);
	});

	test("nothing to merge: nothing more", async () => {
		const merged = async (): Promise<never> => {
			throw new Refusal("conflict", MERGE_WORDS.merged);
		};
		expect(await steps({ preview: merged, run: merged })).toEqual([]);
	});
});

import type { RowBatch } from "@nightshift/engine";
import type { MembershipRecord } from "../../application/ports";
import type {
	MergeRow,
	SplitRow,
	Unfinished,
} from "../../domain/membership-rows";

/** `MembershipRecord` in memory for use-case and contract tests. */
export function inMemoryMembershipRecord(): MembershipRecord & {
	mergesRows: MergeRow[];
	splitsRows: SplitRow[];
} {
	const mergesRows: MergeRow[] = [];
	const splitsRows: SplitRow[] = [];
	let now = 1;

	function nextTime() {
		now += 1;
		return now;
	}

	return {
		mergesRows,
		splitsRows,
		async unfinished(): Promise<Unfinished | null> {
			const split = splitsRows.find((row) => row.state !== "done");
			if (split) return { step: "split", row: split };
			const merge = mergesRows.find((row) => row.state !== "pushed");
			return merge ? { step: "merge", row: merge } : null;
		},
		merges: {
			async latest() {
				return mergesRows.at(-1) ?? null;
			},
			async plan(input) {
				const row: MergeRow = {
					fromSpace: input.fromSpace,
					hostId: input.hostId,
					personId: input.personId,
					state: "planned",
					toSpace: null,
					projectMap: {},
					personMap: {},
					joined: [...input.joined],
					backup: input.backup,
					createdAt: nextTime(),
					updatedAt: nextTime(),
				};
				mergesRows.push(row);
				return row;
			},
			async mapped(fromSpace, input) {
				const row = mergesRows.find((m) => m.fromSpace === fromSpace);
				if (!row) return;
				row.state = "mapped";
				row.toSpace = input.toSpace;
				row.projectMap = input.projectMap;
				row.personMap = input.personMap;
				row.updatedAt = nextTime();
			},
			moved(fromSpace) {
				const row = mergesRows.find((m) => m.fromSpace === fromSpace);
				if (row) {
					row.state = "moved";
					row.updatedAt = nextTime();
				}
				return [] as unknown as RowBatch;
			},
			abandon() {
				for (let i = mergesRows.length - 1; i >= 0; i--) {
					if (mergesRows[i]?.state !== "pushed") mergesRows.splice(i, 1);
				}
				return [] as unknown as RowBatch;
			},
			async pushed(fromSpace) {
				const row = mergesRows.find((m) => m.fromSpace === fromSpace);
				if (row) {
					row.state = "pushed";
					row.updatedAt = nextTime();
				}
			},
		},
		splits: {
			async of(fromSpace) {
				return (
					[...splitsRows]
						.reverse()
						.find((row) => row.fromSpace === fromSpace) ?? null
				);
			},
			async plan(input) {
				const row: SplitRow = {
					...input,
					state: "planned",
					projects: [],
					runs: 0,
					unpinned: 0,
				};
				splitsRows.push(row);
				return row;
			},
			moved(toSpace, input) {
				const row = splitsRows.find((s) => s.toSpace === toSpace);
				if (row) {
					row.state = "moved";
					row.projects = [...input.projects];
					row.runs = input.runs;
					row.unpinned = input.unpinned;
				}
				return [] as unknown as RowBatch;
			},
			async done(toSpace) {
				const row = splitsRows.find((s) => s.toSpace === toSpace);
				if (row) row.state = "done";
			},
		},
	};
}

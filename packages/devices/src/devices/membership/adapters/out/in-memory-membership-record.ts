import type { MembershipRecord } from "../../application/ports";
import type {
	MergeRow,
	SplitRow,
	Unfinished,
} from "../../domain/membership-rows";
import { inMemoryBatch } from "./in-memory-neighbours";

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
			if (split) return { step: "split", row: { ...split } };
			const merge = mergesRows.find((row) => row.state !== "pushed");
			return merge ? { step: "merge", row: { ...merge } } : null;
		},
		merges: {
			async latest() {
				const latest = mergesRows.reduce<MergeRow | null>(
					(a, b) => (a === null || b.updatedAt >= a.updatedAt ? b : a),
					null,
				);
				return latest && { ...latest };
			},
			async done() {
				return mergesRows
					.filter((row) => row.state === "pushed")
					.map((row) => ({ ...row }));
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
					late: null,
					backup: input.backup,
					createdAt: nextTime(),
					updatedAt: nextTime(),
				};
				mergesRows.push(row);
				return { ...row };
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
				return inMemoryBatch(() => {
					const row = mergesRows.find((m) => m.fromSpace === fromSpace);
					if (!row) return;
					row.state = "moved";
					row.updatedAt = nextTime();
				});
			},
			late(fromSpace, input) {
				return inMemoryBatch(() => {
					const row = mergesRows.find((m) => m.fromSpace === fromSpace);
					if (!row) return;
					Object.assign(row, {
						state: "moved",
						late: { ...input },
						updatedAt: nextTime(),
					});
				});
			},
			abandon() {
				return inMemoryBatch(() => {
					for (let i = mergesRows.length - 1; i >= 0; i--) {
						if (mergesRows[i]?.state !== "pushed") mergesRows.splice(i, 1);
					}
				});
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
					paused: [],
					waiting: {},
				};
				splitsRows.push(row);
				return { ...row };
			},
			async paused() {
				return splitsRows
					.filter((row) => row.state !== "planned")
					.map((row) => ({ ...row }));
			},
			async forget(toSpace) {
				const at = splitsRows.findIndex(
					(s) => s.toSpace === toSpace && s.state === "planned",
				);
				if (at >= 0) splitsRows.splice(at, 1);
			},
			moved(toSpace, input) {
				return inMemoryBatch(() => {
					const row = splitsRows.find((s) => s.toSpace === toSpace);
					if (!row) return;
					row.state = "moved";
					row.projects = [...input.projects];
					row.runs = input.runs;
					row.unpinned = input.unpinned;
					row.paused = [...input.paused];
					row.waiting = { ...input.waiting };
				});
			},
			async done(toSpace) {
				const row = splitsRows.find((s) => s.toSpace === toSpace);
				if (row) row.state = "done";
			},
		},
	};
}

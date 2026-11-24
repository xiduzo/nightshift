import type { RowBatch } from "../../../contract";
import type { MoveStore } from "../../application/ports";
import type { ProjectRow, RowMove } from "../../domain/move";

/**
 * The rows of a move in memory: Spaces, Projects, runs, and the facts and
 * answer costs of a Space. A batch is a list of changes that `commit`
 * makes in order. It moves the Projects and their runs as the real batch
 * does. It keeps no Clones, steps or kept values. Test code.
 */

export type MemoryRun = {
	id: string;
	spaceId: string;
	projectId: string;
	walkerId: string;
};

export type MoveRecords = {
	spaces: Set<string>;
	projects: Map<string, ProjectRow>;
	runs: MemoryRun[];
	/** The facts of each Space: `runId` null for a fact of no run. */
	events: { spaceId: string; runId: string | null }[];
	/** The Spaces each answer cost names. */
	answerCosts: { spaceId: string }[];
	/** The batches `commit` ran, in their order. */
	committed: (readonly unknown[])[];
};

export function moveRecords(): MoveRecords {
	return {
		spaces: new Set(),
		projects: new Map(),
		runs: [],
		events: [],
		answerCosts: [],
		committed: [],
	};
}

type Change = (records: MoveRecords) => void;

/** The changes of a move, as the real batch makes them, after its checks. */
function changesOf(records: MoveRecords, move: RowMove): Change[] {
	const { from, to } = move;
	const pairs = Object.entries(move.projectMap);
	const merged = pairs.filter(([source, target]) => source !== target);
	if (move.runsOf !== undefined && merged.length > 0) {
		throw new Error("A move of one Walker's runs keeps every Project's id.");
	}
	for (const [source] of pairs) {
		if (records.projects.get(source)?.spaceId !== from) {
			throw new Error(`The project ${source} is not in the Space ${from}.`);
		}
	}
	for (const [source, target] of merged) {
		if (Object.hasOwn(move.projectMap, target)) {
			throw new Error(`The project ${target} both moves and takes a move.`);
		}
		const row = records.projects.get(target);
		if (row && row.spaceId !== to) {
			throw new Error(`The project ${target} is not in the Space ${to}.`);
		}
		const remote = records.projects.get(source)?.remote ?? null;
		if (row && row.remote !== null && row.remote !== remote) {
			throw new Error(
				`The project ${source} cannot take the place of ${target}: their remotes differ.`,
			);
		}
	}
	const moving = (r: MemoryRun) =>
		r.spaceId === from &&
		Object.hasOwn(move.projectMap, r.projectId) &&
		(move.runsOf === undefined || r.walkerId === move.runsOf);
	return [
		(state) => {
			for (const [source, target] of merged) {
				const row = state.projects.get(source);
				if (row && !state.projects.has(target)) {
					state.projects.set(target, {
						...row,
						id: target,
						spaceId: to,
						remote: null,
					});
				}
			}
		},
		(state) => {
			for (const r of state.runs.filter(moving)) {
				r.projectId = move.projectMap[r.projectId] ?? r.projectId;
				r.spaceId = to;
			}
		},
		(state) => {
			for (const [source, target] of pairs) {
				const row = state.projects.get(source);
				if (!row) continue;
				if (source === target) {
					state.projects.set(source, { ...row, spaceId: to });
					continue;
				}
				state.projects.delete(source);
				const there = state.projects.get(target);
				if (there && there.remote === null && row.remote !== null) {
					state.projects.set(target, { ...there, remote: row.remote });
				}
			}
		},
	];
}

export function inMemoryMoveStore(
	records: MoveRecords = moveRecords(),
): MoveStore {
	return {
		async runIds(spaceId, projectIds, walkerId) {
			return records.runs
				.filter(
					(r) =>
						r.spaceId === spaceId &&
						projectIds.includes(r.projectId) &&
						(walkerId === undefined || r.walkerId === walkerId),
				)
				.map((r) => r.id);
		},
		async projectRows(ids) {
			const rows = new Map<string, ProjectRow>();
			for (const id of ids) {
				const row = records.projects.get(id);
				if (row) rows.set(id, { ...row });
			}
			return rows;
		},
		async batchOf(move) {
			return changesOf(records, move) as unknown as RowBatch;
		},
		emptied(spaceId) {
			const check: Change = (state) => {
				if ([...state.projects.values()].some((p) => p.spaceId === spaceId)) {
					throw new Error(`A project is left in the Space ${spaceId}.`);
				}
			};
			return [check] as unknown as RowBatch;
		},
		async commit(batches) {
			const changes = batches.flatMap((batch) => [...batch]);
			if (changes.length === 0) return;
			// All or nothing, as the real batch.
			const before = {
				projects: new Map(records.projects),
				runs: records.runs.map((r) => ({ ...r })),
			};
			try {
				for (const change of changes) {
					if (typeof change === "function") (change as Change)(records);
				}
			} catch (error) {
				Object.assign(records, before);
				throw error;
			}
			records.committed.push(changes);
		},
		async spaceExists(spaceId) {
			return records.spaces.has(spaceId);
		},
		async holdsRows(spaceId) {
			return (
				[...records.projects.values()].some((p) => p.spaceId === spaceId) ||
				records.runs.some((r) => r.spaceId === spaceId)
			);
		},
		async forgetRows(spaceId) {
			records.answerCosts = records.answerCosts.filter(
				(c) => c.spaceId !== spaceId,
			);
			const runIds = new Set(records.runs.map((r) => r.id));
			records.events = records.events.filter(
				(e) =>
					e.spaceId !== spaceId || (e.runId !== null && runIds.has(e.runId)),
			);
		},
	};
}

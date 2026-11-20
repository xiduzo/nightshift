import { asDate, instant, instantOrNull } from "@nightshift/time";
import type { RowBatch } from "../../../../contract";
import type { ProjectStore } from "../../application/ports";
import type {
	CloneHere,
	ListedProject,
	MovingProject,
	ProjectRecord,
	ProjectRow,
	ProjectsHere,
} from "../../domain/project";

/**
 * `ProjectStore` in memory: the project rows, the Clones of every Device,
 * and the runs this computer walked. A batch of its statements is a list
 * of steps that `apply` runs, as the log runs the real ones. Test code.
 */

/** One statement of a batch, as the twin keeps it. */
type Step =
	| { kind: "clone"; clone: CloneHere }
	| { kind: "move-clone"; clone: CloneHere }
	| { kind: "forget"; deviceId: string }
	| { kind: "adopt"; from: string; to: string };

export type StoredClone = CloneHere & { id: string };

export type ProjectRecords = {
	/** The project rows, oldest first. */
	projects: Map<string, ProjectRecord>;
	/** The Clones of every Device, oldest first. */
	clones: StoredClone[];
	/** The runs walked: `<spaceId>/<projectId>/<deviceId>`. */
	walked: Set<string>;
	/** This computer's Device. */
	deviceId: string;
};

export function projectRecords(deviceId = "this-computer"): ProjectRecords {
	return { projects: new Map(), clones: [], walked: new Set(), deviceId };
}

const asBatch = (steps: Step[]) => steps as unknown as RowBatch;

const moving = (row: ProjectRecord): MovingProject => ({
	id: row.id,
	spaceId: row.spaceId,
	name: row.name,
	remote: row.remote,
	folder: row.folder,
	createdAt: instant(row.createdAt),
	removedAt: instantOrNull(row.removedAt),
});

export function inMemoryProjectStore(
	records: ProjectRecords = projectRecords(),
) {
	let ids = 0;
	const oldestFirst = () =>
		[...records.projects.values()].sort(
			(a, b) => instant(a.createdAt) - instant(b.createdAt),
		);
	const cloneOf = (projectId: string, deviceId = records.deviceId) =>
		records.clones.find(
			(c) => c.projectId === projectId && c.deviceId === deviceId,
		);
	const listed = (row: ProjectRecord): ListedProject => ({
		...row,
		repoPath: cloneOf(row.id)?.path ?? null,
	});
	const holds = (row: ProjectRow, filter: ProjectsHere) =>
		(filter.path === undefined || row.repoPath === filter.path) &&
		(filter.projectId === undefined || row.id === filter.projectId) &&
		(filter.spaceId === undefined || row.spaceId === filter.spaceId) &&
		(!filter.kept || row.removedAt === null) &&
		(!filter.withoutRemote || row.remote === null);
	const insert = (row: Omit<ProjectRecord, "createdAt" | "removedAt">) => {
		records.projects.set(row.id, {
			...row,
			createdAt: asDate(records.projects.size + 1),
			removedAt: null,
		});
	};

	const twin = {
		records,
		/** Adds a project row, as another Replica's change or a migration left it. */
		addProject(
			row: Pick<ProjectRecord, "id" | "spaceId" | "name"> &
				Partial<ProjectRecord>,
		) {
			insert({ remote: null, folder: true, ...row });
			const kept = records.projects.get(row.id);
			if (kept && row.removedAt) kept.removedAt = row.removedAt;
		},
		/** The row follows the entry of its Space document. */
		project(
			spaceId: string,
			id: string,
			entry: {
				name: string;
				remote: string | null;
				folder: boolean;
				removedAt: number | null;
			},
		) {
			if (!records.projects.has(id)) {
				insert({
					id,
					spaceId,
					name: entry.name,
					remote: entry.remote,
					folder: entry.folder,
				});
			}
			const row = records.projects.get(id);
			if (!row || row.spaceId !== spaceId) return;
			row.name = entry.name;
			row.remote = entry.remote;
			row.folder = entry.folder;
			row.removedAt = entry.removedAt === null ? null : asDate(entry.removedAt);
		},
		/** Runs the statements of a batch, as the log runs the real ones. */
		apply(batch: RowBatch) {
			for (const step of batch as unknown as Step[]) {
				if (step.kind === "clone") {
					records.clones.push({ id: `clone-${++ids}`, ...step.clone });
				} else if (step.kind === "move-clone") {
					const clone = cloneOf(step.clone.projectId, step.clone.deviceId);
					if (clone) clone.path = step.clone.path;
				} else if (step.kind === "forget") {
					records.clones = records.clones.filter(
						(c) => c.deviceId !== step.deviceId,
					);
				} else {
					for (const clone of records.clones) {
						if (clone.deviceId === step.from) clone.deviceId = step.to;
					}
				}
			}
		},

		async row(projectId: string) {
			return records.projects.get(projectId) ?? null;
		},
		async find(projectId: string, spaceId?: string) {
			const row = records.projects.get(projectId);
			if (!row || row.removedAt !== null) return null;
			if (spaceId !== undefined && row.spaceId !== spaceId) return null;
			return listed(row);
		},
		async listInSpace(spaceId?: string) {
			return oldestFirst()
				.filter(
					(row) =>
						row.removedAt === null &&
						(spaceId === undefined || row.spaceId === spaceId),
				)
				.map(listed);
		},
		async here(filter: ProjectsHere) {
			return oldestFirst()
				.flatMap((row) => {
					const clone = cloneOf(row.id);
					return clone ? [{ ...row, repoPath: clone.path }] : [];
				})
				.filter((row) => holds(row, filter));
		},
		async byRemote(remote: string) {
			return (
				[...records.projects.values()].find((row) => row.remote === remote) ??
				null
			);
		},
		async clonePath(projectId: string, spaceId?: string) {
			const row = records.projects.get(projectId);
			if (!row || row.removedAt !== null) return null;
			if (spaceId !== undefined && row.spaceId !== spaceId) return null;
			return cloneOf(projectId)?.path ?? null;
		},
		async withoutFolder(projectId: string) {
			const row = records.projects.get(projectId);
			return row?.removedAt === null && row.folder === false;
		},
		async ofSpace(spaceId: string) {
			return oldestFirst()
				.filter((row) => row.spaceId === spaceId)
				.map((row) => ({
					...moving(row),
					clone: cloneOf(row.id) !== undefined,
					walked: records.walked.has(
						`${spaceId}/${row.id}/${records.deviceId}`,
					),
				}));
		},
		async matching(input: {
			ids?: readonly string[];
			remotes?: readonly string[];
		}) {
			const ids = input.ids ?? [];
			const remotes = input.remotes ?? [];
			return [...records.projects.values()]
				.filter(
					(row) =>
						ids.includes(row.id) ||
						(row.remote !== null && remotes.includes(row.remote)),
				)
				.map(moving);
		},
		async keepHosted(row: {
			id: string;
			spaceId: string;
			name: string;
			remote: string;
		}) {
			const kept = records.projects.get(row.id);
			if (!kept) insert({ ...row, folder: true });
			else if (kept.spaceId === row.spaceId) kept.removedAt = null;
		},
		async keepHostedWithoutFolder(row: {
			id: string;
			spaceId: string;
			name: string;
		}) {
			if (!records.projects.has(row.id)) {
				insert({ ...row, remote: null, folder: false });
			}
		},
		async addClone(clone: CloneHere) {
			twin.apply(asBatch([{ kind: "clone", clone }]));
		},
		cloneRow: ({ moved, ...clone }: CloneHere & { moved: boolean }) =>
			asBatch([{ kind: moved ? "move-clone" : "clone", clone }]),
		forgetClones: (deviceId: string) => asBatch([{ kind: "forget", deviceId }]),
		adoptClones: (from: string, to: string) =>
			asBatch([{ kind: "adopt", from, to }]),
	};
	return twin satisfies ProjectStore;
}

export type InMemoryProjectStore = ReturnType<typeof inMemoryProjectStore>;

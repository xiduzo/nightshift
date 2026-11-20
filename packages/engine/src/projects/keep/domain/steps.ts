import { Refusal } from "@nightshift/refusal";
import type { RowBatch } from "../../../contract";
import {
	type CloneRecord,
	type DocumentClone,
	HOSTED_ELSEWHERE,
	type ListedProject,
	type Project,
	type ProjectRecord,
	toProject,
} from "./project";

/**
 * The steps several requests of the Projects share, as pure functions of
 * the steps they take (decision 25 of the hexagon series): each gets the
 * port calls it needs.
 */

/** A change of a Project's entry, as `SpaceProjects.define` takes it. */
type EntryChange = { name?: string; remote?: string | null; removed?: boolean };

/**
 * Changes the Project's entry in its Space document. A Space a Host keeps
 * is refused: its Projects change on the Host only.
 */
export async function defineProject(
	define: (row: ProjectRecord, change: EntryChange) => Promise<boolean>,
	row: ProjectRecord,
	change: EntryChange,
): Promise<void> {
	if (!(await define(row, change))) {
		throw new Refusal("conflict", HOSTED_ELSEWHERE);
	}
}

/** Where a Clone of this computer is, or goes. */
type ClonePlace = {
	spaceId: string;
	projectId: string;
	deviceId: string;
};

/** What recording a Clone of this computer takes. */
type RecordCloneSteps = {
	names(deviceIds: readonly string[]): Promise<Map<string, string>>;
	recordCloneHere(spaceId: string, clone: CloneRecord): Promise<boolean>;
	/** The Host that keeps a Space, when this computer has one. */
	relay:
		| { addClone(input: { spaceId: string } & CloneRecord): Promise<void> }
		| undefined;
};

/**
 * Records this Device's Clone of the Project in its Space document. In a
 * Space a Host keeps, the Host records it.
 */
export async function recordCloneHere(
	steps: RecordCloneSteps,
	place: ClonePlace,
): Promise<void> {
	const { spaceId, projectId, deviceId } = place;
	const names = await steps.names([deviceId]);
	const clone = {
		projectId,
		deviceId,
		deviceName: names.get(deviceId) ?? deviceId,
	};
	if (await steps.recordCloneHere(spaceId, clone)) return;
	if (!steps.relay) throw new Refusal("conflict", HOSTED_ELSEWHERE);
	await steps.relay.addClone({ spaceId, ...clone });
}

/**
 * Makes `path` the folder of the Project's Clone on this computer: a new
 * Clone, or the one here moved (`moved`). The Space knows of it first,
 * through its Host when a Host keeps it. The row and its fact are one
 * batch.
 */
export async function cloneHere(
	steps: RecordCloneSteps & {
		cloneRow(clone: ClonePlace & { path: string; moved: boolean }): RowBatch;
		append(
			fact: {
				type: "CloneAdded";
				payload: { projectId: string; deviceId: string; path: string };
			},
			before: RowBatch,
		): Promise<void>;
	},
	clone: ClonePlace & { path: string },
	moved: boolean,
): Promise<void> {
	await recordCloneHere(steps, clone);
	const { projectId, deviceId, path } = clone;
	await steps.append(
		{ type: "CloneAdded", payload: { projectId, deviceId, path } },
		steps.cloneRow({ ...clone, moved }),
	);
}

/**
 * Defines a new Project in its Space document, and gives its row, which
 * follows the document. A Space a Host keeps is refused with `onHost`.
 */
export async function createProject(
	steps: {
		create(
			spaceId: string,
			projectId: string,
			entry: { name: string; remote: string | null; folder: boolean },
		): Promise<boolean>;
		row(projectId: string): Promise<ProjectRecord | null>;
	},
	request: {
		spaceId: string;
		projectId: string;
		entry: { name: string; remote: string | null; folder: boolean };
		/** The words of the refusal in a Space a Host keeps. */
		onHost: string;
	},
): Promise<ProjectRecord> {
	const { spaceId, projectId, entry } = request;
	if (!(await steps.create(spaceId, projectId, entry))) {
		throw new Refusal("conflict", request.onHost);
	}
	const row = await steps.row(projectId);
	if (!row) throw new Error("Could not add the project.");
	return row;
}

/** Rows as the engine's Projects, with their Clones from the Space document. */
export async function asProjects(
	steps: {
		clones(
			spaceId: string,
			projectIds: readonly string[],
		): Promise<Map<string, DocumentClone[]>>;
		deviceId(): Promise<string>;
	},
	spaceId: string,
	rows: readonly ListedProject[],
): Promise<Project[]> {
	const clones = await steps.clones(
		spaceId,
		rows.map((row) => row.id),
	);
	const deviceId = await steps.deviceId();
	return rows.map((row) => toProject(row, clones.get(row.id) ?? [], deviceId));
}

/** A removed Project comes back: in its Space document, then as a fact. */
export async function restoreProject<T extends ProjectRecord>(
	row: T,
	steps: {
		define(row: ProjectRecord, change: EntryChange): Promise<boolean>;
		append(fact: {
			type: "ProjectRestored";
			payload: { projectId: string };
		}): Promise<void>;
	},
): Promise<T> {
	if (row.removedAt === null) return row;
	await defineProject(steps.define, row, { removed: false });
	await steps.append({
		type: "ProjectRestored",
		payload: { projectId: row.id },
	});
	return { ...row, removedAt: null };
}

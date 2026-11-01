import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { spaceExists } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { clone, project } from "@nightshift/db/schema";
import { Refusal } from "@nightshift/refusal";
import { instant, now as timeNow } from "@nightshift/time";
import { and, asc, eq, getColumns, isNull } from "drizzle-orm";
import type { DeviceDirectory, Relay } from "../contract";
import type { RunLog } from "../log";
import { type Git, systemGit } from "./git";
import { normaliseRemote } from "./remote";
import {
	projectClones,
	projectEntry,
	recordClone,
	type SpaceDocument,
	type SpaceDocuments,
	type SpaceProject,
	spaceProjectSchema,
} from "./space-document";
import {
	type MovingProject,
	projectRowsOf,
	spaceProjectRows,
} from "./space-rows";
import { createWorktrees } from "./worktrees";

/**
 * Projects by remote, and their Clones on this computer. A Project is a
 * repository by its normalised `origin`; a Clone is that repository's
 * folder on one Device. This computer has at most one Clone of a Project,
 * and the engine works in it: `repoPath` of a `ProjectRow` is that folder.
 *
 * - Adding a folder whose `origin` names a Project already known makes a
 *   Clone of it, not a second Project. A folder without a remote is a
 *   Project of its own, on this computer only.
 * - A Project is in exactly one Space. A folder or a remote that is a
 *   Project of another Space is refused, never joined across Spaces.
 * - `readRemotes` fills in the remote of the Projects that have none, from
 *   their Clone here. Rows from before the Clone table get theirs this way
 *   (a migration cannot run git). A remote another Project already has
 *   stays off: the two stay apart, as they were.
 * - A Project's definition (name, remote, removed) is written to its Space
 *   document; the `project` row follows as its projection before the call
 *   returns. A Clone here is a `clone` row (with its path) and an entry in
 *   the Space document (without one).
 * - In a Space a Host keeps, the document is the Host's: a Clone here is
 *   recorded there through the Host (`relay.addClone`), and the Projects
 *   themselves change on the Host only.
 * - On a Host, the peers record another Device's Clone (`recordClone`)
 *   and take the Projects of a Device's personal Space (`take`) in the
 *   Space documents it keeps. They read the Projects through this module
 *   too (`ofSpace`, `matching`, `clones`, `clonePath`): never its rows.
 */

/** A call that needs the project's folder on this computer, for a project without one. */
export const NOT_ON_THIS_COMPUTER =
	"This project is not on this computer. Add its folder here to use it.";

/** A change this Replica cannot make to a Space a Host keeps. */
export const HOSTED_ELSEWHERE =
	"This Space is kept by another computer. Change its projects there.";

/** A project that is not in the Space, or that a person removed. */
export const PROJECT_NOT_FOUND = "Night Shift cannot find this project.";

/** A project row with the path of its Clone on this computer. */
export type ProjectRow = typeof project.$inferSelect & { repoPath: string };

/** A project row with the path of its Clone here, or null: not on this computer. */
export type ListedProject = typeof project.$inferSelect & {
	repoPath: string | null;
};

/**
 * The folder of a project's Clone on this computer (the Replica's own
 * Device, `selfId`), or null: what `localDevice` works in. With a Space, a
 * project of another Space has none. Null too when this computer has no
 * Device yet.
 */
export function clonePathOf(
	db: Database,
	selfId: () => Promise<string | null>,
): (projectId: string, spaceId?: string) => Promise<string | null> {
	return async (projectId, spaceId) => {
		const deviceId = await selfId();
		if (deviceId === null) return null;
		const [row] = await db
			.select({ path: clone.path })
			.from(clone)
			.innerJoin(project, eq(project.id, clone.projectId))
			.where(
				and(
					eq(clone.projectId, projectId),
					eq(clone.deviceId, deviceId),
					isNull(project.removedAt),
					spaceId === undefined ? undefined : eq(project.spaceId, spaceId),
				),
			);
		return row?.path ?? null;
	};
}

export type ProjectsDeps = {
	db: Database;
	log: RunLog;
	/** This computer's Device id. */
	deviceId(): Promise<string>;
	/** The Space documents: the source of the Projects' definitions. */
	documents: SpaceDocuments;
	/** The names of Devices, and the Spaces a Host keeps. */
	directory: Pick<DeviceDirectory, "names" | "hostedElsewhere">;
	/** The Hosts: a Clone in a Space a Host keeps is recorded through it. */
	relay?: Pick<Relay, "addClone">;
	/** The git port, for a clone's top folder and remote. Default: the git programs on this computer. */
	git?: Git;
};

export type Projects = ReturnType<typeof createProjects>;

/** A Device's Clone of a Project, as a Space document records it. */
export type CloneRecord = {
	projectId: string;
	deviceId: string;
	/** The Device's name, as the document shows it. */
	deviceName: string;
};

/** What a Host takes into a Space's document at once (`Projects.take`). */
export type TakenProjects = {
	/** Projects new to the Space: each written only where the document has no entry of it. */
	define?: readonly Omit<MovingProject, "spaceId">[];
	/** Projects a person removed, by id: they come back. */
	restore?: readonly string[];
	/** The Clones of a Device. */
	clones?: readonly CloneRecord[];
};

/**
 * The engine's Project: the row, with the Devices that have a Clone of it
 * (from the Space document).
 */
export function toProject(
	row: ListedProject,
	document: SpaceDocument,
	deviceId: string,
): Project {
	const clones = projectClones(document, row.id).map((c) => ({
		deviceId: c.deviceId,
		deviceName: c.deviceName,
		thisDevice: c.deviceId === deviceId,
	}));
	// A row the document has not seen yet still has its Clone here.
	if (row.repoPath !== null && !clones.some((c) => c.thisDevice)) {
		clones.unshift({ deviceId, deviceName: null, thisDevice: true });
	}
	return {
		id: row.id,
		name: row.name,
		repoPath: row.repoPath,
		remote: row.remote,
		createdAt: instant(row.createdAt),
		clones,
	};
}

export function createProjects(deps: ProjectsDeps) {
	const { db, log, documents, directory } = deps;
	const { originUrl, resolveRepoTopLevel } = createWorktrees(
		deps.git ?? systemGit(),
	);

	/**
	 * Changes the Project's entry in its Space document. An entry the
	 * document lacks (a row from before it) starts from the row.
	 */
	async function define(
		row: typeof project.$inferSelect,
		change: Partial<SpaceProject>,
	): Promise<void> {
		const document = await documents.open(row.spaceId);
		if (document.hostedElsewhere) {
			throw new Refusal("conflict", HOSTED_ELSEWHERE);
		}
		const parsed = spaceProjectSchema.safeParse(document.projects.get(row.id));
		const entry = parsed.success ? parsed.data : projectEntry(row);
		await document.change(() => {
			document.projects.set(row.id, {
				...entry,
				...change,
				updatedAt: timeNow(),
			} satisfies SpaceProject);
		});
	}

	/** Records this Device's Clone of the Project in its Space document. */
	async function recordCloneHere(
		projectId: string,
		spaceId: string,
		deviceId: string,
	): Promise<void> {
		const names = await directory.names([deviceId]);
		const document = await documents.open(spaceId);
		const clone = {
			projectId,
			deviceId,
			deviceName: names.get(deviceId) ?? deviceId,
		};
		if (document.hostedElsewhere) {
			if (!deps.relay) throw new Refusal("conflict", HOSTED_ELSEWHERE);
			await deps.relay.addClone({ spaceId, ...clone });
			return;
		}
		await document.change(() => recordClone(document, clone));
	}

	/** Projects with a Clone on this computer, with its path, removed ones too. */
	async function withClone(where?: ReturnType<typeof and>) {
		const deviceId = await deps.deviceId();
		return db
			.select({ ...getColumns(project), repoPath: clone.path })
			.from(project)
			.innerJoin(
				clone,
				and(eq(clone.projectId, project.id), eq(clone.deviceId, deviceId)),
			)
			.where(where)
			.orderBy(asc(project.createdAt));
	}

	async function restore(row: ProjectRow): Promise<ProjectRow> {
		if (row.removedAt === null) return row;
		await define(row, { removedAt: null });
		await log.append({
			type: "ProjectRestored",
			payload: { projectId: row.id },
		});
		return { ...row, removedAt: null };
	}

	/** The project's row, removed or not. */
	async function rowOf(projectId: string) {
		const [row] = await db
			.select()
			.from(project)
			.where(eq(project.id, projectId));
		if (!row) throw new Refusal("not-found", PROJECT_NOT_FOUND);
		return row;
	}

	/** Only the Space's projects; every Space's without one (background work). */
	const inSpace = (spaceId: string | undefined) =>
		spaceId === undefined ? undefined : eq(project.spaceId, spaceId);

	return {
		/**
		 * The projects with a Clone here a person has not removed, oldest
		 * first: the Space's, or without a Space every Space's.
		 */
		list(spaceId?: string): Promise<ProjectRow[]> {
			return withClone(and(isNull(project.removedAt), inSpace(spaceId)));
		},

		/**
		 * Every project of the Space a person has not removed, oldest first,
		 * also those without a Clone on this computer (`repoPath` null): a
		 * run of one can be walked by another Device. Without a Space, every
		 * Space's: the scheduler's, which fires the schedules of a project
		 * whose runs run on another Device too.
		 */
		async listInSpace(spaceId?: string): Promise<ListedProject[]> {
			const deviceId = await deps.deviceId();
			return db
				.select({ ...getColumns(project), repoPath: clone.path })
				.from(project)
				.leftJoin(
					clone,
					and(eq(clone.projectId, project.id), eq(clone.deviceId, deviceId)),
				)
				.where(and(isNull(project.removedAt), inSpace(spaceId)))
				.orderBy(asc(project.createdAt));
		},

		/**
		 * A project that a person has not removed, with its folder here or
		 * null: what a Space-level change (a rename, a removal, a move) and a
		 * run placed on another Device need. With a Space, a project of
		 * another Space is not found.
		 */
		async find(projectId: string, spaceId?: string): Promise<ListedProject> {
			const deviceId = await deps.deviceId();
			const [row] = await db
				.select({ ...getColumns(project), repoPath: clone.path })
				.from(project)
				.leftJoin(
					clone,
					and(eq(clone.projectId, project.id), eq(clone.deviceId, deviceId)),
				)
				.where(
					and(
						eq(project.id, projectId),
						isNull(project.removedAt),
						inSpace(spaceId),
					),
				);
			if (!row) throw new Refusal("not-found", PROJECT_NOT_FOUND);
			return row;
		},

		/**
		 * A project that a person has not removed, with its folder here. With
		 * a Space, a project of another Space is not found.
		 */
		async get(projectId: string, spaceId?: string): Promise<ProjectRow> {
			const [row] = await withClone(
				and(
					eq(project.id, projectId),
					isNull(project.removedAt),
					inSpace(spaceId),
				),
			);
			if (row) return row;
			const [elsewhere] = await db
				.select({ id: project.id })
				.from(project)
				.where(
					and(
						eq(project.id, projectId),
						isNull(project.removedAt),
						inSpace(spaceId),
					),
				);
			throw elsewhere
				? new Refusal("conflict", NOT_ON_THIS_COMPUTER)
				: new Refusal("not-found", PROJECT_NOT_FOUND);
		},

		/**
		 * The project of the git repository at `path` in the Space: the one
		 * with a Clone there, else the one with its remote, else a new one. A
		 * removed project comes back. A project of another Space is refused.
		 */
		async add(
			input: { repoPath: string; name?: string },
			spaceId: string,
		): Promise<ProjectRow> {
			const path = await resolveRepoTopLevel(input.repoPath);
			const deviceId = await deps.deviceId();
			const [here] = await withClone(eq(clone.path, path));
			if (here) return restore(ownSpace(here, spaceId));

			const url = await originUrl(path);
			const remote = url === null ? null : normaliseRemote(url);
			const [known] = remote
				? await db.select().from(project).where(eq(project.remote, remote))
				: [];
			if (known) {
				ownSpace(known, spaceId);
				const [elsewhere] = await withClone(eq(project.id, known.id));
				if (
					elsewhere &&
					known.removedAt === null &&
					existsSync(elsewhere.repoPath)
				) {
					throw new Refusal(
						"conflict",
						`This computer already has this project, in ${elsewhere.repoPath}. Remove it first to use this folder instead.`,
					);
				}
				// The Space knows of the Clone first: through its Host, when a Host keeps it.
				await recordCloneHere(known.id, spaceId, deviceId);
				// A Clone that moved, or a removed project's: this folder now.
				// The row and its event are one batch.
				await log.append(
					{
						type: "CloneAdded",
						payload: { projectId: known.id, deviceId, path },
					},
					{
						before: [
							elsewhere
								? db
										.update(clone)
										.set({ path })
										.where(
											and(
												eq(clone.projectId, known.id),
												eq(clone.deviceId, deviceId),
											),
										)
								: db.insert(clone).values({
										id: randomUUID(),
										spaceId,
										projectId: known.id,
										deviceId,
										path,
									}),
						],
					},
				);
				return restore({ ...known, repoPath: path });
			}

			// The Space document defines the Project; its row follows.
			const id = randomUUID();
			const name = input.name ?? path.split("/").at(-1) ?? path;
			const document = await documents.open(spaceId);
			if (document.hostedElsewhere) {
				throw new Refusal(
					"conflict",
					"This Space is kept by another computer. Add the project there first, then add this folder.",
				);
			}
			const now = timeNow();
			await document.change(() => {
				document.projects.set(id, {
					name,
					remote,
					createdAt: now,
					removedAt: null,
					updatedAt: now,
				} satisfies SpaceProject);
			});
			const [row] = await db.select().from(project).where(eq(project.id, id));
			if (!row) throw new Error("Could not add the project.");
			await db
				.insert(clone)
				.values({ id: randomUUID(), spaceId, projectId: id, deviceId, path });
			await recordCloneHere(id, spaceId, deviceId);
			await log.append({
				type: "ProjectAdded",
				payload: { projectId: id, name, repoPath: path, remote },
			});
			return { ...row, repoPath: path };
		},

		/** Marks a project removed. Its runs, events and Clones stay. */
		async remove(projectId: string): Promise<void> {
			await define(await rowOf(projectId), { removedAt: timeNow() });
			await log.append({
				type: "ProjectRemoved",
				payload: { projectId },
			});
		},

		/** Gives the project a new name, in its Space document and its row. */
		async rename(projectId: string, name: string): Promise<void> {
			const row = await rowOf(projectId);
			if (row.name === name) return;
			await define(row, { name });
			await log.append({
				type: "ProjectRenamed",
				payload: { projectId, name },
			});
		},

		/**
		 * Refuses a move of the project from `from` to `to`: a Space a Host
		 * keeps changes its projects there, `to` must exist, and the project
		 * must be in `from`. The move itself is a Space move
		 * (`Engine.moveProjects`).
		 */
		async refuseMove(projectId: string, from: string, to: string) {
			if (
				(await directory.hostedElsewhere(from)) ||
				(await directory.hostedElsewhere(to))
			) {
				throw new Refusal("conflict", HOSTED_ELSEWHERE);
			}
			if (!(await spaceExists(db, to))) {
				throw new Refusal("not-found", "That Space does not exist.");
			}
			const row = await rowOf(projectId);
			if (row.spaceId !== from) {
				throw new Refusal("not-found", PROJECT_NOT_FOUND);
			}
		},

		/**
		 * The Projects of a Space, removed ones too, oldest first, with
		 * whether this computer has a Clone of each and walked a run of it
		 * in the Space: what a Device asks its home Host to take when its
		 * own personal Space merges into the Host's, and what a split takes
		 * along.
		 */
		async ofSpace(
			spaceId: string,
		): Promise<(MovingProject & { clone: boolean; walked: boolean })[]> {
			return spaceProjectRows(db, spaceId, await deps.deviceId());
		},

		/**
		 * The Projects of this Replica with one of `ids` or one of
		 * `remotes`, in any Space, removed ones too: what a Host reads
		 * before it takes the Projects of a Device's personal Space (one
		 * Project per remote on a Replica).
		 */
		matching(input: {
			ids?: readonly string[];
			remotes?: readonly string[];
		}): Promise<MovingProject[]> {
			return projectRowsOf(db, input);
		},

		/** The Devices with a Clone of the Project, as its Space document says, oldest Clone first. */
		async clones(
			spaceId: string,
			projectId: string,
		): Promise<{ deviceId: string; deviceName: string | null }[]> {
			return projectClones(await documents.open(spaceId), projectId);
		},

		/**
		 * The folder of the Project's Clone on this computer, or null: none
		 * here, a Project a person removed, or a Project of another Space.
		 */
		async clonePath(
			projectId: string,
			spaceId: string,
		): Promise<string | null> {
			return clonePathOf(db, deps.deviceId)(projectId, spaceId);
		},

		/**
		 * Records another Device's Clone of a Project in the Space's
		 * document: on the Host that keeps the Space. Refused as not found
		 * when this Replica does not keep the Space, or its document has no
		 * entry of the Project.
		 */
		async recordClone(spaceId: string, record: CloneRecord): Promise<void> {
			const document = await documents.open(spaceId);
			if (
				document.hostedElsewhere ||
				!document.projects.has(record.projectId)
			) {
				throw new Refusal("not-found", PROJECT_NOT_FOUND);
			}
			await document.change(() => recordClone(document, record));
		},

		/**
		 * Takes Projects into the Space's document, in one change: new
		 * entries, removed Projects back, and a Device's Clones. A Space a
		 * Host keeps is left alone: only that Host changes it.
		 */
		async take(spaceId: string, taken: TakenProjects): Promise<void> {
			const document = await documents.open(spaceId);
			if (document.hostedElsewhere) return;
			await document.change(() => {
				const now = timeNow();
				for (const { id, ...entry } of taken.define ?? []) {
					if (document.projects.has(id)) continue;
					document.projects.set(id, {
						...entry,
						updatedAt: now,
					} satisfies SpaceProject);
				}
				for (const id of taken.restore ?? []) {
					const entry = document.projects.get(id);
					if (!entry || typeof entry !== "object") continue;
					// A field of a newer version stays as it is.
					document.projects.set(id, {
						...(entry as Record<string, unknown>),
						removedAt: null,
						updatedAt: now,
					});
				}
				for (const record of taken.clones ?? []) {
					recordClone(document, record);
				}
			});
		},

		/** Reads the remote of every project here that has none. A folder that is gone is skipped. */
		async readRemotes(): Promise<void> {
			for (const row of await withClone(isNull(project.remote))) {
				const url = await originUrl(row.repoPath).catch(() => null);
				const remote = url === null ? null : normaliseRemote(url);
				if (remote === null) continue;
				const [taken] = await db
					.select({ id: project.id })
					.from(project)
					.where(eq(project.remote, remote));
				if (taken) continue;
				await define(row, { remote });
			}
		},
	};
}

/** The row, when it is in the Space. A folder is one Space's project at a time. */
function ownSpace<T extends { spaceId: string }>(row: T, spaceId: string): T {
	if (row.spaceId !== spaceId) {
		throw new Refusal(
			"conflict",
			"This folder is a project in another Space. Switch to that Space to use it.",
		);
	}
	return row;
}

export type Project = {
	id: string;
	name: string;
	/**
	 * The folder of the project's Clone on this computer. Null: the project
	 * is not on this computer (another Device of the Space has it); a call
	 * that needs its folder (flows, branches, schedules, a run walked here)
	 * fails until a folder of it is added.
	 */
	repoPath: string | null;
	/** The normalised `origin` (`github.com/acme/app`), null without one. */
	remote: string | null;
	createdAt: number;
	/** The Devices with a Clone of it, from the Space document: this one first. */
	clones: ProjectClone[];
};

/** That a Device has a Clone of a Project. Its path is that Device's own. */
export type ProjectClone = {
	deviceId: string;
	/** The Device's name, as the Space document has it. */
	deviceName: string | null;
	/** This computer. */
	thisDevice: boolean;
};

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
	cloneKey,
	deviceEntries,
	deviceNameIn,
	projectClones,
	projectEntry,
	recordClone,
	type SpaceDocument,
	type SpaceDocuments,
	type SpaceProject,
	spaceProjectSchema,
	withoutFolder,
} from "./space-document";
import {
	type MovingProject,
	projectRowsOf,
	spaceProjectRows,
} from "./space-rows";
import { createWorktrees } from "./worktrees";

/**
 * Projects by remote, and their Clones on this computer. A Project with a
 * folder is a repository by its normalised `origin`; a Clone is that
 * repository's folder on one Device. This computer has at most one Clone
 * of a Project, and the engine works in it: `repoPath` of a `ProjectRow`
 * is that folder.
 *
 * - Adding a folder whose `origin` names a Project already known makes a
 *   Clone of it, not a second Project. A folder without a remote is a
 *   Project of its own, on this computer only.
 * - A Project without a folder (`folder` false, ADR 22) has no remote and
 *   no Clone, on any Device: `addWithoutFolder` adds one. It never gets a
 *   folder: `useFolder` refuses it, and a Clone of it is never recorded.
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
	"Your Host keeps the projects of this Space. Change them on your Host.";

/** A folder without a remote, in a Space a Host keeps: the Host has nothing to copy. */
export const HOSTED_NEEDS_REMOTE =
	"Your Host keeps the projects of this Space and copies them from GitHub. Put this folder on GitHub first, then add it again.";

/** A project that is not in the Space, or that a person removed. */
export const PROJECT_NOT_FOUND = "Night Shift cannot find this project.";

/** A folder for a project without one: it cannot get one (ADR 22). */
export const NO_FOLDER =
	"This project has no folder, and it cannot get one. Add the folder as a new project instead.";

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

/**
 * Whether a project has no folder (ADR 22): no Device has a Clone of it,
 * so what works for it here works in a folder of its own. False for a
 * project this Replica does not know, or that a person removed.
 */
export function withoutFolderOf(
	db: Database,
): (projectId: string) => Promise<boolean> {
	return async (projectId) => {
		const [row] = await db
			.select({ folder: project.folder })
			.from(project)
			.where(and(eq(project.id, projectId), isNull(project.removedAt)));
		return row?.folder === false;
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
	/** The Hosts: a Project or a Clone in a Space a Host keeps is added through it. */
	relay?: Pick<Relay, "addClone" | "addProject" | "addWithoutFolder">;
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
		folder: row.folder,
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

	/**
	 * Makes `path` the folder of the Project's Clone on this computer: a new
	 * Clone, or the one here moved (`moved`). The Space knows of it first,
	 * through its Host when a Host keeps it. The row and its event are one
	 * batch.
	 */
	async function cloneHere(
		projectId: string,
		spaceId: string,
		deviceId: string,
		path: string,
		moved: boolean,
	): Promise<void> {
		await recordCloneHere(projectId, spaceId, deviceId);
		await log.append(
			{ type: "CloneAdded", payload: { projectId, deviceId, path } },
			{
				before: [
					moved
						? db
								.update(clone)
								.set({ path })
								.where(
									and(
										eq(clone.projectId, projectId),
										eq(clone.deviceId, deviceId),
									),
								)
						: db.insert(clone).values({
								id: randomUUID(),
								spaceId,
								projectId,
								deviceId,
								path,
							}),
				],
			},
		);
	}

	/**
	 * Asks the Host that keeps the Space to add the Project, and keeps its
	 * row here at once: the Space document brings the same entry a moment
	 * later, and its projection finds the row in step.
	 */
	async function addOnHost(
		spaceId: string,
		input: { name: string; remote: string },
	): Promise<typeof project.$inferSelect> {
		if (!deps.relay) throw new Refusal("conflict", HOSTED_ELSEWHERE);
		const { projectId } = await deps.relay.addProject({ spaceId, ...input });
		await db
			.insert(project)
			.values({ id: projectId, spaceId, ...input })
			.onConflictDoUpdate({
				target: project.id,
				set: { removedAt: null },
				where: eq(project.spaceId, spaceId),
			});
		return rowOf(projectId);
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

	async function restore<T extends typeof project.$inferSelect>(
		row: T,
	): Promise<T> {
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

	/**
	 * Defines a new Project without a folder in the Space's document,
	 * which this Replica keeps: for a person here (`addWithoutFolder`),
	 * and on a Host for a Device that asks it. Each call adds another
	 * Project: a name may repeat.
	 */
	async function defineWithoutFolder(
		spaceId: string,
		input: { name: string },
	): Promise<{ projectId: string }> {
		const document = await documents.open(spaceId);
		if (document.hostedElsewhere) {
			throw new Refusal("conflict", HOSTED_ELSEWHERE);
		}
		const id = randomUUID();
		const now = timeNow();
		await document.change(() => {
			document.projects.set(id, {
				name: input.name,
				remote: null,
				folder: false,
				createdAt: now,
				removedAt: null,
				updatedAt: now,
			} satisfies SpaceProject);
		});
		const [row] = await db.select().from(project).where(eq(project.id, id));
		if (!row) throw new Error("Could not add the project.");
		await log.append({
			type: "ProjectAdded",
			payload: { projectId: id, name: input.name, remote: null, folder: false },
		});
		return { projectId: id };
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
			const [found] = remote
				? await db.select().from(project).where(eq(project.remote, remote))
				: [];
			if (found) ownSpace(found, spaceId);
			// A Space a Host keeps: the Host adds a new Project, or restores a
			// removed one, and this folder becomes its Clone.
			const onHost =
				remote !== null &&
				(!found || found.removedAt !== null) &&
				(await directory.hostedElsewhere(spaceId));
			const known = onHost
				? await addOnHost(spaceId, {
						name: input.name ?? path.split("/").at(-1) ?? path,
						remote,
					})
				: found;
			if (known) {
				ownSpace(known, spaceId);
				const [elsewhere] = await withClone(eq(project.id, known.id));
				// A removed project's Clone may move: its Host restored it just now.
				if (
					elsewhere &&
					(found?.removedAt ?? null) === null &&
					existsSync(elsewhere.repoPath)
				) {
					throw new Refusal(
						"conflict",
						`This computer already has this project, in ${elsewhere.repoPath}. Choose Change folder in its menu to use this folder instead.`,
					);
				}
				await cloneHere(known.id, spaceId, deviceId, path, Boolean(elsewhere));
				return restore({ ...known, repoPath: path });
			}

			// The Space document defines the Project; its row follows.
			const id = randomUUID();
			const name = input.name ?? path.split("/").at(-1) ?? path;
			const document = await documents.open(spaceId);
			if (document.hostedElsewhere) {
				throw new Refusal("conflict", HOSTED_NEEDS_REMOTE);
			}
			const now = timeNow();
			await document.change(() => {
				document.projects.set(id, {
					name,
					remote,
					folder: true,
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

		/**
		 * Makes the git repository at `path` the project's folder on this
		 * computer: its first one, or in place of the one it has. The folder
		 * must hold the project's repository (its `origin` names the
		 * project's remote, in any case), and be no other project's folder.
		 */
		async useFolder(
			projectId: string,
			repoPath: string,
			spaceId: string,
		): Promise<ProjectRow> {
			const row = await rowOf(projectId);
			if (row.removedAt !== null || row.spaceId !== spaceId) {
				throw new Refusal("not-found", PROJECT_NOT_FOUND);
			}
			if (!row.folder) throw new Refusal("conflict", NO_FOLDER);
			const path = await resolveRepoTopLevel(repoPath);
			const deviceId = await deps.deviceId();
			const [taken] = await withClone(eq(clone.path, path));
			if (taken?.id === projectId) return { ...row, repoPath: path };
			if (taken) {
				throw new Refusal(
					"conflict",
					`This folder is the project ${taken.name} already. Choose another folder.`,
				);
			}
			const url = await originUrl(path);
			const remote = url === null ? null : normaliseRemote(url);
			if (remote?.toLowerCase() !== row.remote?.toLowerCase()) {
				throw new Refusal(
					"invalid",
					row.remote === null
						? "This folder has a remote repository, and this project has none. Choose the folder of this project."
						: `This folder holds another repository. Choose a copy of ${row.remote}.`,
				);
			}
			const [here] = await withClone(eq(project.id, projectId));
			await cloneHere(projectId, spaceId, deviceId, path, Boolean(here));
			return { ...row, repoPath: path };
		},

		/**
		 * The Project of a remote in the Space, for a Device that asks its
		 * Host (`relay.addProject`): the one with this remote, restored when
		 * a person removed it, else a new one without a Clone here. The
		 * Host copies it from GitHub on its own.
		 */
		async addFromRemote(
			spaceId: string,
			input: { name: string; remote: string },
		): Promise<{ projectId: string }> {
			// Normalised by the Device, as its own `add` does (`github.com/acme/app`).
			const { remote } = input;
			const [found] = await db
				.select()
				.from(project)
				.where(eq(project.remote, remote));
			if (found) {
				await restore(ownSpace(found, spaceId));
				return { projectId: found.id };
			}
			const document = await documents.open(spaceId);
			if (document.hostedElsewhere) {
				throw new Refusal("conflict", HOSTED_ELSEWHERE);
			}
			const id = randomUUID();
			const now = timeNow();
			await document.change(() => {
				document.projects.set(id, {
					name: input.name,
					remote,
					folder: true,
					createdAt: now,
					removedAt: null,
					updatedAt: now,
				} satisfies SpaceProject);
			});
			const [row] = await db.select().from(project).where(eq(project.id, id));
			if (!row) throw new Error("Could not add the project.");
			await log.append({
				type: "ProjectAdded",
				payload: { projectId: id, name: input.name, remote },
			});
			return { projectId: id };
		},

		/**
		 * A new Project without a folder in the Space (ADR 22): no remote,
		 * no Clone, on any Device. In a Space a Host keeps, the Host adds it
		 * (`relay.addWithoutFolder`), and its row is kept here at once: the
		 * Space document brings the same entry a moment later.
		 */
		async addWithoutFolder(
			input: { name: string },
			spaceId: string,
		): Promise<ListedProject> {
			if (await directory.hostedElsewhere(spaceId)) {
				if (!deps.relay) throw new Refusal("conflict", HOSTED_ELSEWHERE);
				const { projectId } = await deps.relay.addWithoutFolder({
					spaceId,
					name: input.name,
				});
				await db
					.insert(project)
					.values({
						id: projectId,
						spaceId,
						name: input.name,
						remote: null,
						folder: false,
					})
					.onConflictDoNothing();
				return { ...(await rowOf(projectId)), repoPath: null };
			}
			const { projectId } = await defineWithoutFolder(spaceId, input);
			return { ...(await rowOf(projectId)), repoPath: null };
		},

		defineWithoutFolder,

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

		/**
		 * Removes a Device from the Space documents this Replica keeps: its
		 * Clones and its name. On a Host, when its owner removes a Device for
		 * good. A Space a Host keeps elsewhere is that Host's to change.
		 */
		async forgetDevice(deviceId: string): Promise<void> {
			for (const document of await documents.openAll()) {
				if (document.hostedElsewhere) continue;
				const { clones, named } = deviceEntries(document, deviceId);
				if (clones.length === 0 && !named) continue;
				await document.change(() => {
					for (const key of clones) document.clones.delete(key);
					if (named) document.devices.delete(deviceId);
				});
			}
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
			// An older Device may give a folder to a project without one.
			if (withoutFolder(document, record.projectId)) {
				throw new Refusal("conflict", NO_FOLDER);
			}
			await document.change(() => recordClone(document, record));
		},

		/**
		 * The Projects of the Space with a Clone on this computer, removed
		 * ones too: what this Device tells the Host that keeps the Space it
		 * has (`setClones`), so a Clone the Host missed heals.
		 */
		async clonedHere(spaceId: string): Promise<string[]> {
			const rows = await withClone(eq(project.spaceId, spaceId));
			return rows.map((row) => row.id);
		},

		/**
		 * Makes a Device's Clones in the Space's document exactly the
		 * Projects it says it has: on the Host that keeps the Space. A
		 * Project the document lacks is left out, and so is one without a
		 * folder. When they are in step, the document does not change: the
		 * Device may say it again and again.
		 * Refused as not found when this Replica does not keep the Space.
		 */
		async setClones(
			spaceId: string,
			input: {
				deviceId: string;
				deviceName: string;
				projectIds: readonly string[];
			},
		): Promise<{ added: string[]; removed: string[] }> {
			const document = await documents.open(spaceId);
			if (document.hostedElsewhere) {
				throw new Refusal("not-found", PROJECT_NOT_FOUND);
			}
			const has = new Set(
				input.projectIds.filter(
					(id) => document.projects.has(id) && !withoutFolder(document, id),
				),
			);
			const known = new Set(deviceEntries(document, input.deviceId).projectIds);
			const added = [...has].filter((id) => !known.has(id));
			const removed = [...known].filter((id) => !has.has(id));
			const named = deviceNameIn(document, input.deviceId);
			const rename = has.size > 0 && named !== input.deviceName;
			if (added.length === 0 && removed.length === 0 && !rename) {
				return { added, removed };
			}
			await document.change(() => {
				for (const projectId of removed) {
					document.clones.delete(cloneKey(projectId, input.deviceId));
				}
				for (const projectId of has) {
					recordClone(document, { ...input, projectId });
				}
			});
			return { added, removed };
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
	/**
	 * False: the project has no folder (ADR 22). It has no remote and no
	 * Clone, and each of its runs gets an empty folder of its own.
	 */
	folder: boolean;
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

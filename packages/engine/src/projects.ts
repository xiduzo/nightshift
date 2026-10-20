import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { Database } from "@nightshift/db";
import {
	agentSession,
	clone,
	device,
	event,
	organization,
	project,
	run,
	step,
} from "@nightshift/db/schema";
import {
	and,
	asc,
	eq,
	getColumns,
	inArray,
	isNull,
	or,
	sql,
} from "drizzle-orm";

import { isHostedElsewhere } from "./exchange/host-spaces";
import type { RunLog } from "./run-log";
import {
	cloneKey,
	projectClones,
	projectEntry,
	recordClone,
	type SpaceDocument,
	type SpaceDocuments,
	type SpaceProject,
	spaceProjectSchema,
} from "./space/document";
import type { Project, Relay } from "./types";
import { originUrl, resolveRepoTopLevel } from "./worktrees";

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
 */

/** A call that needs the project's folder on this computer, for a project without one. */
export const NOT_ON_THIS_COMPUTER =
	"This project is not on this computer. Add its folder here to use it.";

/** A change this Replica cannot make to a Space a Host keeps. */
export const HOSTED_ELSEWHERE =
	"This Space is kept by another computer. Change its projects there.";

/** A project row with the path of its Clone on this computer. */
export type ProjectRow = typeof project.$inferSelect & { repoPath: string };

/** A project row with the path of its Clone here, or null: not on this computer. */
export type ListedProject = typeof project.$inferSelect & {
	repoPath: string | null;
};

/**
 * The folder of a project's Clone on this computer (the Replica's own
 * Device), or null: what `localDevice` works in. With a Space, a project of
 * another Space has none.
 */
export function clonePathOf(
	db: Database,
): (projectId: string, spaceId?: string) => Promise<string | null> {
	return async (projectId, spaceId) => {
		const [row] = await db
			.select({ path: clone.path })
			.from(clone)
			.innerJoin(device, eq(device.id, clone.deviceId))
			.innerJoin(project, eq(project.id, clone.projectId))
			.where(
				and(
					eq(clone.projectId, projectId),
					eq(device.self, true),
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
	/** The Hosts: a Clone in a Space a Host keeps is recorded through it. */
	relay?: Pick<Relay, "addClone">;
};

export type Projects = ReturnType<typeof createProjects>;

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
		createdAt: row.createdAt.getTime(),
		clones,
	};
}

export function createProjects(deps: ProjectsDeps) {
	const { db, log, documents } = deps;

	/**
	 * Changes the Project's entry in its Space document. An entry the
	 * document lacks (a row from before it) starts from the row.
	 */
	async function define(
		row: typeof project.$inferSelect,
		change: Partial<SpaceProject>,
	): Promise<void> {
		const document = await documents.open(row.spaceId);
		if (document.hostedElsewhere) throw new Error(HOSTED_ELSEWHERE);
		const parsed = spaceProjectSchema.safeParse(document.projects.get(row.id));
		const entry = parsed.success ? parsed.data : projectEntry(row);
		await document.change(() => {
			document.projects.set(row.id, {
				...entry,
				...change,
				updatedAt: Date.now(),
			} satisfies SpaceProject);
		});
	}

	/** Records this Device's Clone of the Project in its Space document. */
	async function recordCloneHere(
		projectId: string,
		spaceId: string,
		deviceId: string,
	): Promise<void> {
		const [self] = await db
			.select({ name: device.name })
			.from(device)
			.where(eq(device.id, deviceId));
		const document = await documents.open(spaceId);
		const clone = { projectId, deviceId, deviceName: self?.name ?? deviceId };
		if (document.hostedElsewhere) {
			if (!deps.relay) throw new Error(HOSTED_ELSEWHERE);
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
		if (!row) throw new Error(`Project not found: ${projectId}`);
		return row;
	}

	/** Only the Space's projects; every Space's without one (background work). */
	const inSpace = (spaceId: string | undefined) =>
		spaceId === undefined ? undefined : eq(project.spaceId, spaceId);

	return {
		/**
		 * The projects a person has not removed, oldest first: the Space's,
		 * or without a Space every Space's (the scheduler's).
		 */
		list(spaceId?: string): Promise<ProjectRow[]> {
			return withClone(and(isNull(project.removedAt), inSpace(spaceId)));
		},

		/**
		 * Every project of the Space a person has not removed, oldest first,
		 * also those without a Clone on this computer (`repoPath` null): a
		 * run of one can be walked by another Device.
		 */
		async listInSpace(spaceId: string): Promise<ListedProject[]> {
			const deviceId = await deps.deviceId();
			return db
				.select({ ...getColumns(project), repoPath: clone.path })
				.from(project)
				.leftJoin(
					clone,
					and(eq(clone.projectId, project.id), eq(clone.deviceId, deviceId)),
				)
				.where(and(isNull(project.removedAt), eq(project.spaceId, spaceId)))
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
			if (!row) throw new Error(`Project not found: ${projectId}`);
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
			throw new Error(
				elsewhere ? NOT_ON_THIS_COMPUTER : `Project not found: ${projectId}`,
			);
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
					throw new Error(
						`This computer already has this project, in ${elsewhere.repoPath}. Remove it first to use this folder instead.`,
					);
				}
				// The Space knows of the Clone first: through its Host, when a Host keeps it.
				await recordCloneHere(known.id, spaceId, deviceId);
				// A Clone that moved, or a removed project's: this folder now.
				if (elsewhere) {
					await db
						.update(clone)
						.set({ path })
						.where(
							and(eq(clone.projectId, known.id), eq(clone.deviceId, deviceId)),
						);
				} else {
					await db.insert(clone).values({
						id: randomUUID(),
						spaceId,
						projectId: known.id,
						deviceId,
						path,
					});
				}
				await log.append({
					type: "CloneAdded",
					payload: { projectId: known.id, deviceId, path },
				});
				return restore({ ...known, repoPath: path });
			}

			// The Space document defines the Project; its row follows.
			const id = randomUUID();
			const name = input.name ?? path.split("/").at(-1) ?? path;
			const document = await documents.open(spaceId);
			if (document.hostedElsewhere) {
				throw new Error(
					"This Space is kept by another computer. Add the project there first, then add this folder.",
				);
			}
			const now = Date.now();
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
			await define(await rowOf(projectId), { removedAt: Date.now() });
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
		 * Moves the project to another Space: its row, Clones, runs, steps,
		 * sessions and events take the new Space in one transaction. Then
		 * the new Space's document gets its entry and Clones, and the old
		 * one loses them. `ProjectMoved` is logged in the new Space.
		 */
		async move(projectId: string, from: string, to: string): Promise<void> {
			if (from === to) return;
			if (
				(await isHostedElsewhere(db, from)) ||
				(await isHostedElsewhere(db, to))
			) {
				throw new Error(HOSTED_ELSEWHERE);
			}
			const [target] = await db
				.select({ id: organization.id })
				.from(organization)
				.where(eq(organization.id, to));
			if (!target) throw new Error("That Space does not exist.");
			const row = await rowOf(projectId);
			if (row.spaceId !== from) {
				throw new Error(`Project not found: ${projectId}`);
			}
			const runs = db
				.select({ id: run.id })
				.from(run)
				.where(eq(run.projectId, projectId));
			await db.transaction(async (tx) => {
				await tx
					.update(project)
					.set({ spaceId: to })
					.where(eq(project.id, projectId));
				await tx
					.update(clone)
					.set({ spaceId: to })
					.where(eq(clone.projectId, projectId));
				await tx
					.update(step)
					.set({ spaceId: to })
					.where(inArray(step.runId, runs));
				await tx
					.update(agentSession)
					.set({ spaceId: to })
					.where(inArray(agentSession.runId, runs));
				await tx
					.update(event)
					.set({ spaceId: to })
					.where(
						or(
							inArray(event.runId, runs),
							and(
								isNull(event.runId),
								sql`json_extract(${event.payload}, '$.projectId') = ${projectId}`,
							),
						),
					);
				await tx
					.update(run)
					.set({ spaceId: to })
					.where(eq(run.projectId, projectId));
			});

			const source = await documents.open(from);
			const destination = await documents.open(to);
			const parsed = spaceProjectSchema.safeParse(
				source.projects.get(projectId),
			);
			const entry = parsed.success ? parsed.data : projectEntry(row);
			const clones = projectClones(source, projectId);
			await destination.change(() => {
				destination.projects.set(projectId, {
					...entry,
					updatedAt: Date.now(),
				} satisfies SpaceProject);
				for (const c of clones) {
					recordClone(destination, {
						projectId,
						deviceId: c.deviceId,
						deviceName: c.deviceName ?? c.deviceId,
					});
				}
			});
			await source.change(() => {
				source.projects.delete(projectId);
				for (const c of clones) {
					source.clones.delete(cloneKey(projectId, c.deviceId));
				}
			});
			await log.append({
				type: "ProjectMoved",
				payload: { projectId, from, to },
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
		throw new Error(
			"This folder is a project in another Space. Switch to that Space to use it.",
		);
	}
	return row;
}

/**
 * One string for every URL of one repository: `host/path`, without the
 * scheme, the user or password, the port, and `.git`. So
 * `git@github.com:acme/app.git`, `ssh://git@github.com/acme/app` and
 * `https://github.com/acme/app.git` are all `github.com/acme/app`. The
 * host is lower case; the path keeps its case. Null for a path or a
 * `file:` URL: a repository on this computer is no other Device's.
 */
export function normaliseRemote(url: string): string | null {
	const trimmed = url.trim();
	if (trimmed === "" || /^[a-z]:[\\/]/i.test(trimmed)) return null;
	let host: string;
	let path: string;
	const withScheme = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(trimmed);
	if (withScheme) {
		const [, scheme = "", rest = ""] = withScheme;
		if (scheme.toLowerCase() === "file") return null;
		const slash = rest.indexOf("/");
		const authority = slash === -1 ? rest : rest.slice(0, slash);
		path = slash === -1 ? "" : rest.slice(slash + 1);
		host = authority.slice(authority.lastIndexOf("@") + 1).replace(/:\d*$/, "");
	} else {
		// scp-like: `[user@]host:path`. Anything else is a path.
		const scp = /^(?:[^@/]+@)?([^:/]+):(.*)$/.exec(trimmed);
		if (!scp) return null;
		host = scp[1] ?? "";
		path = scp[2] ?? "";
	}
	path = path
		.replace(/^\/+|\/+$/g, "")
		.replace(/\.git$/i, "")
		.replace(/\/+$/, "");
	if (host === "" || path === "") return null;
	return `${host.toLowerCase()}/${path}`;
}

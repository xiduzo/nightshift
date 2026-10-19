import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { Database } from "@nightshift/db";
import { clone, project } from "@nightshift/db/schema/nightshift";
import { and, asc, eq, getColumns, isNull } from "drizzle-orm";

import type { RunLog } from "./run-log";
import type { Project } from "./types";
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
 */

/** A project row with the path of its Clone on this computer. */
export type ProjectRow = typeof project.$inferSelect & { repoPath: string };

export type ProjectsDeps = {
	db: Database;
	log: RunLog;
	/** This computer's Device id. */
	deviceId(): Promise<string>;
};

export type Projects = ReturnType<typeof createProjects>;

export function toProject(row: ProjectRow): Project {
	return {
		id: row.id,
		name: row.name,
		repoPath: row.repoPath,
		remote: row.remote,
		createdAt: row.createdAt.getTime(),
	};
}

export function createProjects(deps: ProjectsDeps) {
	const { db, log } = deps;

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
		await db
			.update(project)
			.set({ removedAt: null })
			.where(eq(project.id, row.id));
		await log.append({
			type: "ProjectRestored",
			payload: { projectId: row.id },
		});
		return { ...row, removedAt: null };
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
			if (!row) throw new Error(`Project not found: ${projectId}`);
			return row;
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

			const id = randomUUID();
			const name = input.name ?? path.split("/").at(-1) ?? path;
			const [row] = await db
				.insert(project)
				.values({ id, spaceId, name, remote })
				.returning();
			if (!row) throw new Error("Could not add the project.");
			await db
				.insert(clone)
				.values({ id: randomUUID(), spaceId, projectId: id, deviceId, path });
			await log.append({
				type: "ProjectAdded",
				payload: { projectId: id, name, repoPath: path, remote },
			});
			return { ...row, repoPath: path };
		},

		/** Marks a project removed. Its runs, events and Clones stay. */
		async remove(projectId: string): Promise<void> {
			await db
				.update(project)
				.set({ removedAt: new Date() })
				.where(eq(project.id, projectId));
			await log.append({
				type: "ProjectRemoved",
				payload: { projectId },
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
				await db.update(project).set({ remote }).where(eq(project.id, row.id));
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

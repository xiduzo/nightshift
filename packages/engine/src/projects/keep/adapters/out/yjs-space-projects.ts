import { now as timeNow } from "@nightshift/time";
import {
	cloneKey,
	deviceEntries,
	deviceNameIn,
	projectClones,
	projectEntry,
	recordClone,
	type SpaceDocuments,
	type SpaceProject,
	spaceProjectSchema,
	withoutFolder,
} from "../../../../documents";
import type { SpaceProjects } from "../../application/ports";

/**
 * `SpaceProjects` over the Space documents (Yjs). Each write is one
 * `change` of one document, as before the rings: the order of the
 * projection and of the observers does not change.
 */
export function yjsSpaceProjects(
	documents: Pick<SpaceDocuments, "open" | "openAll">,
): SpaceProjects {
	return {
		async define(row, { removed, ...change }) {
			// A removal is stamped when it is asked, as before the rings.
			const removedAt =
				removed === undefined ? {} : { removedAt: removed ? timeNow() : null };
			const document = await documents.open(row.spaceId);
			if (document.hostedElsewhere) return false;
			const parsed = spaceProjectSchema.safeParse(
				document.projects.get(row.id),
			);
			const entry = parsed.success ? parsed.data : projectEntry(row);
			await document.change(() => {
				document.projects.set(row.id, {
					...entry,
					...change,
					...removedAt,
					updatedAt: timeNow(),
				} satisfies SpaceProject);
			});
			return true;
		},

		async create(spaceId, projectId, entry) {
			const document = await documents.open(spaceId);
			if (document.hostedElsewhere) return false;
			const now = timeNow();
			await document.change(() => {
				document.projects.set(projectId, {
					name: entry.name,
					remote: entry.remote,
					folder: entry.folder,
					createdAt: now,
					removedAt: null,
					updatedAt: now,
				} satisfies SpaceProject);
			});
			return true;
		},

		async recordCloneHere(spaceId, clone) {
			const document = await documents.open(spaceId);
			if (document.hostedElsewhere) return false;
			await document.change(() => recordClone(document, clone));
			return true;
		},

		async recordClone(spaceId, record) {
			const document = await documents.open(spaceId);
			if (
				document.hostedElsewhere ||
				!document.projects.has(record.projectId)
			) {
				return "unknown";
			}
			// A Device may give a folder to a project without one.
			if (withoutFolder(document, record.projectId)) return "without-folder";
			await document.change(() => recordClone(document, record));
			return "recorded";
		},

		async setClones(spaceId, input) {
			const document = await documents.open(spaceId);
			if (document.hostedElsewhere) return null;
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

		async take(spaceId, taken) {
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

		async forgetDevice(deviceId) {
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

		async clones(spaceId, projectIds) {
			const document = await documents.open(spaceId);
			return new Map(
				projectIds.map((id) => [id, projectClones(document, id)] as const),
			);
		},
	};
}

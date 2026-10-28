import type { DeviceKeyAccess } from "@nightshift/auth";
import {
	personalSpaceId,
	personalSpaceIdBySlug,
	roleAllows,
	spacesOf,
} from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import {
	projectRowsOf,
	recordClone,
	type SpaceDocument,
	type SpaceDocuments,
} from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import type {
	ElsewhereProject,
	PersonalMerge,
	PersonalMergeInput,
} from "../contract";

/**
 * The Host's half of the merge of a Device's own personal Space into its
 * Person's personal Space here (ADR 1): `sync.mergePersonal`. The Device
 * lists its Projects. The Host puts each one in the personal Space of the
 * key's Person, in that Space's document (its rows follow), and answers
 * with the id each Project has here. The Device then moves its rows and
 * pushes them: the Projects are here before their runs.
 *
 * - One Project per remote on a Replica. A Project of the Device whose
 *   remote is a Project of the personal Space here takes that Project's
 *   id. One whose remote is a Project of a shared Space here, a Space the
 *   Person is a Member of, moves into that Project only when the Person
 *   chose it (`join`) and their role there allows adding projects: its
 *   runs become visible to the Members of that Space. Otherwise it is a
 *   Project of its own in the personal Space, without its remote here,
 *   and the answer lists it (`elsewhere`). A remote of a Space the Person
 *   is not a Member of is never named.
 * - Every other Project keeps its id. A removed one stays removed.
 * - The Device's Clones are recorded in the Space documents here.
 * - It runs again with the same answer: a Project here with the
 *   Device's id is the one it took before.
 * - `dryRun` answers the same and changes nothing.
 */
export async function mergePersonalHere(
	deps: { db: Database; documents: SpaceDocuments },
	key: DeviceKeyAccess,
	device: { name: string },
	input: PersonalMergeInput,
): Promise<PersonalMerge> {
	const { db, documents } = deps;
	const spaceId =
		(await personalSpaceIdBySlug(db, key.personId)) ??
		(await personalSpaceId(db, key.personId));
	if (spaceId === null) {
		throw new Refusal(
			"not-found",
			"Your personal Space is not on this Host. Sign in on the Host once, then try again.",
		);
	}
	const personal = await documents.open(spaceId);
	if (personal.hostedElsewhere) {
		throw new Refusal(
			"conflict",
			"This Host does not keep your personal Space itself.",
		);
	}
	const projects = input.projects;
	const join = new Set(input.join ?? []);
	const known = await projectRowsOf(db, {
		ids: projects.map((p) => p.id),
		remotes: projects.flatMap((p) => (p.remote === null ? [] : [p.remote])),
	});
	const byId = new Map(known.map((row) => [row.id, row]));
	const byRemote = new Map(
		known.flatMap((row) => (row.remote === null ? [] : [[row.remote, row]])),
	);
	const spaces = new Map(
		(await spacesOf(db, key.personId)).map((space) => [space.id, space]),
	);

	const projectMap: Record<string, string> = {};
	const elsewhere: ElsewhereProject[] = [];
	/** What each Space document gets, by Space. */
	const changes = new Map<string, ((document: SpaceDocument) => void)[]>();
	const change = (target: string, apply: (document: SpaceDocument) => void) => {
		changes.set(target, [...(changes.get(target) ?? []), apply]);
	};
	const clone = (target: string, projectId: string) =>
		change(target, (document) =>
			recordClone(document, {
				projectId,
				deviceId: key.deviceId,
				deviceName: device.name,
			}),
		);

	for (const p of projects) {
		const taken = byId.get(p.id);
		if (taken) {
			// Taken before: the merge runs again.
			if (taken.spaceId !== spaceId) {
				throw new Refusal(
					"conflict",
					`The project ${p.name} has the id of another project on this Host. Nothing was merged.`,
				);
			}
			projectMap[p.id] = p.id;
			if (p.clone) clone(spaceId, p.id);
			continue;
		}
		const there = p.remote === null ? undefined : byRemote.get(p.remote);
		if (there && there.spaceId === spaceId) {
			projectMap[p.id] = there.id;
			if (there.removedAt !== null && p.removedAt === null) {
				change(spaceId, (document) => {
					const entry = document.projects.get(there.id);
					if (entry && typeof entry === "object") {
						document.projects.set(there.id, {
							...(entry as Record<string, unknown>),
							removedAt: null,
							updatedAt: Date.now(),
						});
					}
				});
			}
			if (p.clone) clone(spaceId, there.id);
			continue;
		}
		const space = there ? spaces.get(there.spaceId) : undefined;
		if (there && space && p.remote !== null) {
			const joined =
				join.has(p.id) && roleAllows(space.role, { project: ["add"] });
			elsewhere.push({
				projectId: p.id,
				name: p.name,
				remote: p.remote,
				spaceId: space.id,
				spaceName: space.name,
				hostProjectId: there.id,
				joined,
			});
			if (joined) {
				projectMap[p.id] = there.id;
				if (p.clone) clone(space.id, there.id);
				continue;
			}
		}
		// A Project of its own here. Its remote goes when another Project
		// here has it: a Replica keeps one Project per remote.
		projectMap[p.id] = p.id;
		const entry = {
			name: p.name,
			remote: there ? null : p.remote,
			createdAt: p.createdAt,
			removedAt: p.removedAt,
			updatedAt: Date.now(),
		};
		change(spaceId, (document) => {
			if (!document.projects.has(p.id)) document.projects.set(p.id, entry);
		});
		if (p.clone) clone(spaceId, p.id);
	}

	if (!input.dryRun) {
		// The personal Space first: the Projects that move are there.
		const order = [
			spaceId,
			...[...changes.keys()].filter((s) => s !== spaceId),
		];
		for (const target of order) {
			const applies = changes.get(target);
			if (!applies) continue;
			const document = await documents.open(target);
			if (document.hostedElsewhere) continue;
			await document.change(() => {
				for (const apply of applies) apply(document);
			});
		}
	}

	return {
		spaceId,
		projectMap,
		personMap:
			input.personId === key.personId ? {} : { [input.personId]: key.personId },
		elsewhere,
	};
}

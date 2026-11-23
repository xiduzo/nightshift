import type { Profile, Schedule } from "@nightshift/flows";
import {
	type CloneHere,
	type CloneImport,
	changedSinceMessage,
	flowRenames,
	folderSchedules,
	freeLabel,
	type ImportNotice,
	importMarker,
	incomingFlows,
	keptMessage,
	type LabelledProfile,
	profileNotices,
	sameProfile,
	schedulesToAdd,
	withCalls,
} from "../domain/clone-import";
import type { TrackedState } from "../domain/legacy-folder";
import { parseLegacyProfiles } from "../domain/legacy-profiles";
import type {
	Clock,
	CloneDocuments,
	CloneFolders,
	DeviceProfiles,
	Migrations,
	SavedDocuments,
	ThisDevice,
} from "./ports";

export type ImportCloneFolderPorts = {
	documents: CloneDocuments;
	folders: CloneFolders;
	saved: SavedDocuments;
	device: ThisDevice;
	clock: Clock;
	/** Without them, a folder with profiles stays. */
	profiles?: DeviceProfiles | undefined;
	/** Without them, a node keeps its profile's name, to pick again. */
	migrations?: Migrations | undefined;
};

/**
 * Imports the `.nightshift/` folder of a Clone into its Project's flow
 * document and this Device's profiles, unless an import of this Clone is
 * done (the rules: `domain/clone-import.ts`). The flows name this Device's
 * profiles by id, the ones just made too. The folder goes only after
 * every document is flushed.
 */
export const importCloneFolder =
	(ports: ImportCloneFolderPorts) =>
	async (request: { clone: CloneHere }): Promise<CloneImport> => {
		const { clone } = request;
		const document = await ports.documents.open(clone.projectId);
		const device = await ports.device.device();
		const at = ports.clock();
		const marker = importMarker(clone.id);
		if (document.marked(marker)) return { status: "already" };

		const folder = await ports.folders.read(clone.repoPath);
		if (folder === null) {
			await document.mark(marker, at);
			return { status: "no-folder" };
		}

		const problems: string[] = [];
		if (folder.unknown.length > 0) {
			problems.push("The folder holds other files.");
		}
		const notices: ImportNotice[] = [];

		// Project profiles become this Device's.
		const madeProfiles: string[] = [];
		if (folder.profiles !== null) {
			const { profiles, issues } = parseLegacyProfiles(folder.profiles);
			if (issues.length > 0) {
				problems.push("Some of the project's profiles are not valid.");
			}
			if (profiles.length > 0 && !ports.profiles) {
				problems.push("This computer cannot keep the project's profiles.");
			} else if (ports.profiles) {
				const made = await importProfiles(ports.profiles, profiles);
				madeProfiles.push(...made.made);
				notices.push(...profileNotices(device.name, made));
			}
		}

		// The flows name this Device's profiles by id, the ones just made too.
		const { migrations } = ports;
		const migration = migrations
			? await migrations.forDevice((await ports.device.device()).id, {
					spaceId: clone.spaceId,
				})
			: undefined;

		// Flows: those the document has with the same content come in once.
		const incoming = incomingFlows(folder, migration, problems);
		const { renamed, known } = flowRenames(
			incoming,
			document.flows(),
			device.name,
			notices,
		);
		const nameOf = (name: string) => renamed.get(name) ?? name;

		// Schedules, with the flows they start under their new names.
		const schedules: Schedule[] = folderSchedules(folder, problems);
		const current = document.schedules();
		const addedSchedules = schedulesToAdd(
			schedules,
			current,
			nameOf,
			device.name,
			notices,
		);

		// The flows, each with a revision of kind `import`.
		const saved: string[] = [];
		for (const [name, flow] of incoming) {
			if (known.has(name)) continue;
			await document.saveFlow({
				name: nameOf(name),
				flow: withCalls(flow, renamed),
				kind: "import",
				personId: null,
				deviceId: device.id,
				at,
			});
			saved.push(nameOf(name));
		}
		if (addedSchedules.length > 0) {
			await document.saveSchedules([...current, ...addedSchedules]);
		}

		let state: TrackedState | "unknown";
		try {
			state = await ports.folders.tracked(clone.repoPath, folder);
		} catch {
			state = "unknown";
		}
		const keep = problems.length > 0 || state !== "untracked";
		if (keep) {
			notices.push({
				kind: "folder-kept",
				message: keptMessage(device.name, state, problems),
			});
		}
		await document.mark(
			marker,
			at,
			notices.map((notice) => ({ ...notice, deviceId: device.id, at })),
		);
		// Everything is in the Replica before anything of the folder goes.
		await ports.saved.flush();

		let deleted = false;
		if (!keep) {
			deleted = await ports.folders
				.remove(clone.repoPath, folder)
				.catch(() => false);
			if (!deleted) {
				await document.addNotices([
					{
						kind: "folder-kept",
						message: changedSinceMessage(device.name),
						deviceId: device.id,
						at,
					},
				]);
			}
		}
		return {
			status: "imported",
			flows: saved,
			renamed: Object.fromEntries(renamed),
			profiles: madeProfiles,
			deleted,
		};
	};

/**
 * Gives the project's profiles to this Device. A profile it has already,
 * with the same settings, comes in once, also from an import that did not
 * end. Returns the labels it made, and the profiles that got another label.
 */
async function importProfiles(
	store: DeviceProfiles,
	profiles: readonly Profile[],
): Promise<{ made: string[]; labelled: LabelledProfile[] }> {
	const made: string[] = [];
	const labelled: LabelledProfile[] = [];
	for (const profile of profiles) {
		const list = store.list();
		const own = list.find((each) => each.name === profile.name);
		if (own === undefined) {
			const idTaken = list.some((each) => each.id === profile.name);
			await store.save(profile, idTaken ? undefined : profile.name);
			made.push(profile.name);
			continue;
		}
		if (sameProfile(own, profile)) continue;
		const base = `${profile.name}_project`;
		const copy = list.find(
			(each) => each.name.startsWith(base) && sameProfile(each, profile),
		);
		if (copy) continue;
		const label = freeLabel(base, new Set(list.map((each) => each.name)));
		await store.save({ ...profile, name: label });
		labelled.push({ name: profile.name, label });
	}
	return { made, labelled };
}

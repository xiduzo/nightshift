import type { Context } from "@nightshift/api/context";
import type { Database } from "@nightshift/db";
import { createFlowDocuments, createSpaceDocuments } from "@nightshift/engine";
import {
	createCloneTracker,
	wireCopies,
	wireKeep,
	wireSetup,
} from "@nightshift/engine/projects";
import type { SettingsStore } from "@nightshift/engine/settings";
import {
	canChooseFolder,
	chooseFolder,
	type HotRegistry,
	type HotSlots,
} from "./runtime";

type SpaceDocumentsDeps = Parameters<typeof createSpaceDocuments>[0];
type CopiesDeps = Parameters<typeof wireCopies>[0];
type Settings = SettingsStore;

/**
 * The projects block of the daemon's composition (`daemon.ts`): the Space
 * and flow documents, and where a project's folder is here. The lanes of
 * `projects` and `flows` edit this file, not `daemon.ts`. Nothing is read
 * until a call asks.
 */
export function wireDaemonProjects(deps: {
	db: Database;
	documents: SpaceDocumentsDeps["documents"];
	directory: SpaceDocumentsDeps["directory"];
	/** This computer's Device id, once its row exists. */
	selfId: () => Promise<string>;
	/** Tells the open screens; set once the notifications exist. */
	projectsChanged: (spaceId: string) => void;
}) {
	const { db, documents } = deps;
	/**
	 * The Space documents: each Space's Projects, Clones (existence only) and
	 * Members. The engine defines Projects in them, the relay serves them to
	 * Members, and the auth hooks keep their Members in step.
	 */
	const spaces = createSpaceDocuments({
		db,
		directory: deps.directory,
		documents,
		onProjected: (spaceId) => deps.projectsChanged(spaceId),
	});
	/** The rows of the Projects, read for this computer's Device (`projects/keep`). */
	const { store } = wireKeep({
		db,
		documents: spaces,
		thisDevice: { deviceId: deps.selfId },
	});
	return {
		spaces,
		/** The flow documents: each Project's flows and schedules, and their revisions. */
		flows: createFlowDocuments({ db, documents }),
		/** The project's folder here: where its runs' worktrees branch from. */
		clonePath: (projectId: string, spaceId?: string) =>
			store.clonePath(projectId, spaceId),
		/** Whether a project works without a folder (ADR 22). */
		withoutFolder: (projectId: string) => store.withoutFolder(projectId),
	};
}

/**
 * The project copies and the guided setup of a project's folder: what the
 * API's project setup routes call.
 */
export async function wireProjectCopies(deps: {
	slots: Pick<HotSlots<HotRegistry>, "keep" | "replace">;
	dataDir: string;
	spaceIds: CopiesDeps["spaceIds"];
	space: CopiesDeps["space"];
	settings: Settings;
	usage: CopiesDeps["usage"];
}): Promise<Context["projectSetup"]> {
	const { slots, settings } = deps;
	const setup = wireSetup();
	// A clone from GitHub outlives a `bun --hot` reload: keep who tracks it.
	const tracker = await slots.keep("nightshiftCloneTracker", () =>
		createCloneTracker(),
	);
	/**
	 * "Copy every project": a Host copies each project of its Spaces it has
	 * no Clone of. New on each reload, so it adds Clones through this
	 * engine. A clone it started goes on in the tracker.
	 */
	const { gitHub, copies } = wireCopies({
		dataDir: deps.dataDir,
		tracker,
		spaceIds: deps.spaceIds,
		space: deps.space,
		enabled: () => {
			const current = settings.current();
			return current.host && current.copyProjects;
		},
		...(deps.usage ? { usage: deps.usage } : {}),
	});
	const projectCopies = await slots.replace(
		"nightshiftProjectCopies",
		() => copies,
		(before) => before.stop(),
	);
	projectCopies.start();
	return {
		check: (path) => setup.check(path),
		setUpGit: (input) => setup.setUpGit(input),
		installGit: () => setup.installGit(),
		chooseFolder: (prompt) => chooseFolder(prompt),
		folderPicker: canChooseFolder(),
		gitHub,
		copies: projectCopies,
	};
}

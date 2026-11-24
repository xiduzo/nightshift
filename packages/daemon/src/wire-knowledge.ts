import {
	createKnowledgeFolderLocks,
	createOllama,
	createSpaceArchive,
	type Knowledge,
	measuredMeaning,
	transcriptLines,
	wireKnowledge,
} from "@nightshift/engine";
import {
	type ConfigStores,
	reachesPrivateNetwork,
} from "@nightshift/engine/settings";
import {
	type DaemonEnv,
	type HotRegistry,
	type HotSlots,
	hot,
	stopOlderKnowledge,
} from "./runtime";

type KnowledgeDeps = Parameters<typeof wireKnowledge>[0];
type FollowRunsDeps = Parameters<Knowledge["followRuns"]>[0];

/**
 * The knowledge block of the daemon's composition (`daemon.ts`): the
 * Ollama, the Space archive and the projects' knowledge on this computer.
 * The lanes of `knowledge` edit this file, not `daemon.ts`.
 */
export async function wireDaemonKnowledge(deps: {
	env: DaemonEnv;
	slots: Pick<HotSlots<HotRegistry>, "keep" | "replace">;
	db: KnowledgeDeps["db"];
	dataDir: string;
	documents: KnowledgeDeps["documents"];
	/** Who may act in a Space (`wireDaemonAccess`). */
	access: KnowledgeDeps["access"];
	device: KnowledgeDeps["device"];
	usage: KnowledgeDeps["usage"];
	settings: ConfigStores["settings"];
	/** This computer's secrets: the Ollama's headers, and the page readers' keys. */
	secrets: ConfigStores["connections"];
	/** Tells the open screens; set once the notifications exist. */
	learningsChanged: (spaceId: string, projectId: string) => Promise<void>;
}) {
	const { env, slots, dataDir, settings, secrets } = deps;
	/**
	 * The Ollama search by meaning and Decision nodes use: the owner's
	 * address, else OLLAMA_HOST, else this computer's. A Host (or a
	 * computer whose owner turns it on) starts `ollama serve` itself when
	 * none answers here, with its models in the data folder, and downloads
	 * the embedding model. It follows the settings and the secrets.
	 */
	const ollama = await slots.replace(
		"nightshiftOllama",
		() =>
			createOllama({
				dataDir,
				settings,
				secrets,
				env: { ...process.env, ...env },
			}),
		(before) => before.stop(),
	);
	/**
	 * This computer's Space archive (`<dataDir>/archive`): the walk files of
	 * runs walked elsewhere and the knowledge content by hash, here and at
	 * the Spaces' Hosts once the devices runtime connects it. One over the
	 * folder, for the knowledge and the devices both.
	 */
	const archive = createSpaceArchive(dataDir);
	/**
	 * The projects' knowledge on this computer (`<dataDir>/knowledge`):
	 * each folder a working copy of its Project's knowledge in the Space
	 * (ADR 4), in step before and after each step that gets it, and when
	 * the Knowledge page reads it. The content travels by hash through the
	 * archive. Search finds by words, and by meaning when the Ollama above
	 * has the embedding model, unless a person turned it off for the
	 * project.
	 *
	 * Replaced on a reload, whole: this daemon's closures and the code of
	 * this reload, with nothing kept but what is on disk. The one before
	 * closes first, so one Knowledge prepares vectors. The next search
	 * opens the index file again, and what the one before knew of it comes
	 * back from the file: unchanged sections are not embedded again.
	 */
	stopOlderKnowledge(hot);
	const folderLocks = await slots.keep(
		"nightshiftKnowledgeFolderLocks",
		createKnowledgeFolderLocks,
	);
	const knowledge = await slots.replace(
		"nightshiftKnowledge",
		() => {
			return wireKnowledge({
				db: deps.db,
				access: deps.access,
				dataDir,
				documents: deps.documents,
				archive,
				folderLocks,
				device: deps.device,
				usage: deps.usage,
				meaning: () => measuredMeaning(ollama.meaning()),
				// The page readers reach this computer's network as a Web request
				// does, and take their key from this computer's secrets for a look.
				privateNetwork: () => reachesPrivateNetwork(settings.current()),
				secret: (name) => secrets.secret(name),
				notifications: {
					learningsChanged: (spaceId, projectId) =>
						deps.learningsChanged(spaceId, projectId),
				},
			});
		},
		(before) => before.close(),
	);
	return { ollama, archive, knowledge };
}

/**
 * Learnings from runs that ended (ADR 37): when a run this computer walks
 * ends with a signal, the Learner proposes what to learn, into the
 * project's knowledge. Its cost goes to the run's Space. A reload stops
 * the one before: one look back follows the runs.
 */
export async function followRunLearnings(deps: {
	slots: Pick<HotSlots<HotRegistry>, "replace">;
	runs: FollowRunsDeps["runs"];
	knowledge: Pick<Knowledge, "followRuns">;
	/** Makes the Learner, when the look back starts. */
	learner: () => FollowRunsDeps["learn"];
}) {
	await deps.slots.replace(
		"nightshiftRunLearnings",
		() => {
			const learnings = deps.knowledge.followRuns({
				runs: deps.runs,
				learn: deps.learner(),
				lines: transcriptLines,
			});
			return { stop: learnings.follow() };
		},
		(before) => before.stop(),
	);
}

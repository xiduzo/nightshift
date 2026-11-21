import type { Database } from "@nightshift/db";
import { now as timeNow } from "@nightshift/time";
import type { SyncedDocuments } from "../../documents";
import { LOCAL_ONLY_BYTES } from "../../file-loaders";
import type { KnowledgeFolders } from "../files";
import {
	type KnowledgeTimes,
	startKnowledgeTimers,
} from "./adapters/in/knowledge-timers";
import { drizzleProjectSpaces } from "./adapters/out/drizzle-project-spaces";
import { fsWorkingCopy } from "./adapters/out/fs-working-copy";
import { yjsKnowledgeDocuments } from "./adapters/out/yjs-knowledge-documents";
import { collectUnlistedContent } from "./application/collect-unlisted-content";
import { holdFolder, type KnowledgeStepHold } from "./application/hold-folder";
import { measureKnowledgeDocuments } from "./application/measure-knowledge-documents";
import {
	type MoveProjectKnowledge,
	moveProjectKnowledge,
} from "./application/move-project-knowledge";
import type {
	ContentArchive,
	KnowledgeDocuments,
	MeasureNotes,
	ReconcileListener,
	SpaceHosts,
} from "./application/ports";
import { reconcileAllFolders } from "./application/reconcile-all-folders";
import { reconcileFolder } from "./application/reconcile-folder";
import { reconcileUnlessHeld } from "./application/reconcile-unless-held";
import { removeSourceFolder } from "./application/remove-source-folder";
import { retryPendingFolders } from "./application/retry-pending-folders";
import type { KnowledgeFolderLocks } from "./domain/folder-locks";
import { createOlderHosts, type OlderHosts } from "./domain/older-hosts";

/**
 * The wiring of knowledge/sync: the one place that builds its real adapters
 * and binds each use case to its ports.
 */

/** What the knowledge gives knowledge/sync: the ports another part fills, and what the real adapters stand on. */
export type SyncDeps = {
	db: Database;
	/** This Replica's synced documents: the knowledge documents are some of them. Default: its own over `db`. */
	documents?: SyncedDocuments;
	/** The knowledge folders on this computer (`files`). */
	folders: Pick<KnowledgeFolders, "folder" | "known" | "scan">;
	/** The content by hash: here, and at the Space's Host. */
	archive: ContentArchive;
	/** The turns and the holds of each folder. One set per process: they must outlive a reload. */
	locks: KnowledgeFolderLocks;
	/** This Device: it signs the entries it writes. */
	deviceId: string;
	/** The Hosts of the Spaces. Without it, a reconcile waits for no Host. */
	hosts?: SpaceHosts;
	/** What hears of each reconcile. */
	listener?: ReconcileListener;
	/** Where the size of each knowledge document goes, once a day. */
	usage?: MeasureNotes;
	/** Which Hosts run an older version. Default: its own. A test gives one to share it between two wires. */
	older?: OlderHosts;
	/** The clock. Default `now`. */
	now?: () => number;
};

/**
 * What the knowledge knows about a Project's Space and its Host: which
 * Space, and whether its Host can take this knowledge now. The merge, the
 * reader and the learnings ask the same questions.
 */
export type SpaceHostStatus = {
	/** The Space of a Project. Null for a Project this Replica does not have. */
	spaceOf(projectId: string): Promise<string | null>;
	/** Whether a Space has Members besides one Person: it is not a personal Space. */
	isShared(spaceId: string): Promise<boolean>;
	/** Whether the Space's Host runs an older version of Night Shift, as far as this Device knows now. */
	isOlder(spaceId: string): boolean;
	/** What a failed knowledge call to the Host says about it. */
	heard(spaceId: string, error: unknown): void;
};

/** A project's knowledge, as each Device keeps it in step with the Space. */
export type KnowledgeReconciler = {
	/** Brings the folder and the document in step (`reconcileFolder`). */
	reconcile(projectId: string): Promise<void>;
	/** A step that gets the folder starts (`holdFolder`). */
	startStep(projectId: string): Promise<KnowledgeStepHold>;
	/** A reconcile that never fails, and none while a step writes the folder. */
	reconcileUnlessHeld(projectId: string): Promise<unknown>;
	/** Removes a folder of the knowledge for every Device (`removeSourceFolder`). Returns how many files. */
	removeFolder(projectId: string, folder: string): Promise<number>;
	/** Moves a Project's knowledge after a Space move (`moveProjectKnowledge`). */
	move(project: MoveProjectKnowledge): Promise<void>;
	/** Reconciles every folder on this computer. */
	reconcileAll(): Promise<void>;
	/** Reconciles the folders whose content waits for the Host. */
	retryPending(): Promise<void>;
};

/** The sync of the projects' knowledge with the Space, bound to its ports. */
export type KnowledgeSync = {
	documents: KnowledgeDocuments;
	status: SpaceHostStatus;
	reconciler: KnowledgeReconciler;
	/**
	 * Starts the timers: every folder a moment after this, each minute the
	 * ones whose content waits, once a day the collection (only with
	 * `keeps`) and the measure. Returns what stops them.
	 */
	startTimers(options: {
		keeps?: (spaceId: string) => Promise<boolean>;
		times?: Partial<KnowledgeTimes>;
	}): () => void;
};

export function wireSync(deps: SyncDeps): KnowledgeSync {
	const now = deps.now ?? timeNow;
	const copy = fsWorkingCopy(deps.folders);
	const documents = yjsKnowledgeDocuments({
		db: deps.db,
		...(deps.documents ? { documents: deps.documents } : {}),
	});
	const spaces = drizzleProjectSpaces(deps.db);
	const older = deps.older ?? createOlderHosts();
	const { archive, locks } = deps;
	/** The projects whose content waits for the Host. */
	const pending = new Set<string>();

	const reconcileOne = reconcileFolder({
		copy,
		documents,
		archive,
		spaces,
		hosts: deps.hosts ?? {},
		listener: deps.listener ?? {},
		older,
		now,
		locks,
		pending,
		deviceId: deps.deviceId,
		localOnlyBytes: LOCAL_ONLY_BYTES,
	});
	const reconcile = (projectId: string) => reconcileOne({ projectId });
	const startStep = holdFolder({ copy, locks, reconcile });
	const unlessHeld = reconcileUnlessHeld({ copy, locks, reconcile });
	const removeFolder = removeSourceFolder({
		copy,
		locks,
		documents,
		reconcile,
	});
	const move = moveProjectKnowledge({
		copy,
		documents,
		archive,
		locks,
		pending,
	});
	const reconcileAll = reconcileAllFolders({ copy, locks, reconcile });
	const retryPending = retryPendingFolders({ copy, locks, pending, reconcile });
	const measure = measureKnowledgeDocuments({
		documents,
		...(deps.usage ? { notes: deps.usage } : {}),
	});

	return {
		documents,
		status: {
			spaceOf: spaces.spaceOf,
			isShared: spaces.isShared,
			isOlder: (spaceId) => older.isOlder(spaceId, now()),
			heard: (spaceId, error) => older.heard(spaceId, error, now()),
		},
		reconciler: {
			reconcile,
			startStep: (projectId) => startStep({ projectId }),
			reconcileUnlessHeld: (projectId) => unlessHeld({ projectId }),
			removeFolder: (projectId, folder) => removeFolder({ projectId, folder }),
			move,
			reconcileAll,
			retryPending,
		},
		startTimers({ keeps, times }) {
			const collect = keeps
				? collectUnlistedContent({
						archive,
						documents,
						spaces,
						hosts: { keeps },
						now,
					})
				: null;
			return startKnowledgeTimers(
				{ reconcileAll, retryPending, collect: () => collect?.(), measure },
				times,
			);
		},
	};
}

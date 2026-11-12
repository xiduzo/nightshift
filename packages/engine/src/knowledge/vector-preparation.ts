import { Document } from "@langchain/core/documents";
import { index } from "@langchain/core/indexing";
import { now } from "@nightshift/time";
import type { KnowledgeMeaning, KnowledgeMeaningReady } from "./meaning";
import type { SearchStore } from "./search-store";
import { embedText } from "./sections";

/**
 * Keeps the vectors of each project in step with its sections, in the
 * background, one project at a time. A search never waits for it: it uses
 * the vectors there are.
 *
 * Each project is in one state:
 *
 * - `idle`: its vectors are behind, or nothing is known of them yet.
 * - `queued`: it waits for its turn. `idle` or `failed` get here by `request`,
 *   `failed` only `RETRY_MS` after it failed.
 * - `preparing`: `index()` runs. Only from `queued`, when the model is there
 *   and ready and the setting is on. If not, `queued` goes back to `idle`.
 * - `ready`: every section has its vector.
 * - `failed`: the last preparation threw. What it embedded stays.
 *
 * Two inputs say the vectors are behind: `sectionsChanged` for one project,
 * `vectorsGone` for all of them (another model, a new index). Neither embeds
 * by itself. Embedding costs real time on a person's computer, so a project
 * prepares only when someone looks at it, which is `request`. That is also
 * what tries a failed preparation again: there are no timers.
 *
 * What may start is read when the turn comes, not when the project is queued:
 * the queue can wait behind another project for a long time.
 *
 * Change detection, each layer for its own cost: the store's `files` row saves
 * reading and splitting a file, the record hash in `index()` saves embedding a
 * section, and the state here saves asking `index()` when nothing changed.
 */

export type VectorPreparationState =
	| "idle"
	| "queued"
	| "preparing"
	| "failed"
	| "ready";

/** A project went from one state to another. */
export type VectorPreparationEvent = {
	projectId: string;
	from: VectorPreparationState;
	to: VectorPreparationState;
	/** The clock when it happened. */
	at: number;
	/** With `failed`: what went wrong. */
	error?: unknown;
};

/** After a failed preparation, how long until the next try. */
export const RETRY_MS = 60_000;
/** Sections embedded in one call to the model. */
const EMBED_BATCH = 32;

type Project = {
	state: VectorPreparationState;
	/** While `preparing`: its sections or vectors changed, so it runs again. */
	behind: boolean;
	/** While `failed`: when it failed. */
	failedAt: number;
};

export function createVectorPreparation(options: {
	store: SearchStore;
	/** The embedding model now. Null: search by meaning is off. */
	model: () => KnowledgeMeaning | null;
	/** Whether a person left search by meaning on for the project. Never throws. */
	meaningOn: (projectId: string) => Promise<boolean>;
	clock?: () => number;
	onEvent?: (event: VectorPreparationEvent) => void;
}) {
	const { store, clock = now, onEvent } = options;
	const projects = new Map<string, Project>();
	/** Preparations run one project at a time. */
	let queue: Promise<void> = Promise.resolve();
	/** What the last check of the model said, to log a change once. */
	let lastReady: KnowledgeMeaningReady | null = null;

	function projectOf(projectId: string): Project {
		let project = projects.get(projectId);
		if (!project) {
			project = { state: "idle", behind: false, failedAt: 0 };
			projects.set(projectId, project);
		}
		return project;
	}

	function move(
		projectId: string,
		to: VectorPreparationState,
		error?: unknown,
	): void {
		const project = projectOf(projectId);
		const from = project.state;
		project.state = to;
		onEvent?.({
			projectId,
			from,
			to,
			at: clock(),
			...(error !== undefined ? { error } : {}),
		});
	}

	/** Whether the model can embed now. A change is logged once. */
	async function readiness(
		model: KnowledgeMeaning,
	): Promise<KnowledgeMeaningReady> {
		const ready = await model.ready();
		if (ready !== lastReady && (lastReady !== null || ready !== "ready")) {
			console.info(
				ready === "ready"
					? `Knowledge search finds by meaning again, with ${model.model}.`
					: ready === "downloading"
						? `Knowledge search finds by words only while ${model.model} downloads.`
						: ready === "no-model"
							? `Knowledge search finds by words only: Ollama does not have ${model.model}. Download it on the Settings page.`
							: `Knowledge search finds by words only: Ollama does not answer${model.where ? ` at ${model.where}` : " on this computer"}.`,
			);
		}
		lastReady = ready;
		return ready;
	}

	/** Someone looks at the project: its preparation goes in the queue, if it may. */
	function request(projectId: string): void {
		if (!options.model() || !store.isOpen()) return;
		const project = projectOf(projectId);
		const may =
			project.state === "idle" ||
			(project.state === "failed" && clock() - project.failedAt >= RETRY_MS);
		if (!may) return;
		move(projectId, "queued");
		queue = queue.then(() => prepare(projectId));
	}

	/**
	 * One preparation: embeds the sections that have no vector yet and drops
	 * the vectors of sections that went, through `index()`. Every section goes
	 * in, with `cleanup: "full"`: a removed file is not seen, and only `full`
	 * removes what was not seen. An unchanged section costs a hash and a
	 * look-up, no embedding. Never throws.
	 */
	async function prepare(projectId: string): Promise<void> {
		const model = options.model();
		// Closed meanwhile: a preparation does not open the index again.
		if (
			!model ||
			!store.isOpen() ||
			!(await options.meaningOn(projectId)) ||
			(await readiness(model)) !== "ready" ||
			!store.isOpen()
		) {
			move(projectId, "idle");
			return;
		}
		const project = projectOf(projectId);
		const opening = store.opening();
		try {
			// Before `behind` is cleared: a new model makes every project behind.
			const vectors = store.vectorsFor(projectId, model);
			project.behind = false;
			move(projectId, "preparing");
			await index({
				docsSource: store.sectionsToEmbed(projectId).map(
					(section) =>
						new Document({
							pageContent: embedText(
								section.title,
								section.heading_path,
								section.text,
							),
							// `index()` hashes this: only what does not move when a section moves.
							metadata: { path: section.path, section_id: section.section_id },
						}),
				),
				recordManager: store.recordsOf(projectId),
				vectorStore: vectors,
				options: {
					cleanup: "full",
					sourceIdKey: "path",
					batchSize: EMBED_BATCH,
				},
			});
			const nowModel = store.vectorModel();
			// The model changed while this one embedded: its vectors may be mixed in.
			if (nowModel !== null && nowModel !== model.model) {
				store.resetVectors(nowModel);
			}
		} catch (error) {
			// Closed while it ran, and maybe opened again since: its handles are
			// gone, and that is not a failure. The next look prepares again.
			if (!store.isOpen() || store.opening() !== opening) {
				move(projectId, "idle");
				return;
			}
			project.failedAt = clock();
			console.warn(
				"Knowledge search could not prepare its search by meaning:",
				error,
			);
			move(projectId, "failed", error);
			return;
		}
		if (project.behind) {
			move(projectId, "idle");
			request(projectId);
			return;
		}
		move(projectId, "ready");
	}

	return {
		/** The project's sections changed: its vectors are behind. */
		sectionsChanged(projectId: string): void {
			const project = projectOf(projectId);
			if (project.state === "ready") move(projectId, "idle");
			else if (project.state === "preparing") project.behind = true;
		},
		/** Every project's vectors are behind, and a failure says nothing any more. */
		vectorsGone(): void {
			for (const [projectId, project] of projects) {
				if (project.state === "ready" || project.state === "failed") {
					move(projectId, "idle");
				} else if (project.state === "preparing") {
					project.behind = true;
				}
			}
		},
		request,
		stateOf: (projectId: string): VectorPreparationState =>
			projects.get(projectId)?.state ?? "idle",
		readiness,
	};
}

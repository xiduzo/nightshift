import type { KnowledgeMeaning, KnowledgeMeaningReady } from "./meaning";

/**
 * The state of the vectors of each project, kept current in the background,
 * one project at a time. A search never waits for them: it uses the vectors
 * there are.
 *
 * Each project is in one state:
 *
 * - `idle`: its vectors are behind, or nothing is known of them yet.
 * - `queued`: it waits for its turn. `idle` or `failed` get here by a request,
 *   `failed` only `RETRY_MS` after it failed.
 * - `preparing`: `index()` runs. Only from `queued`, when the model is there
 *   and ready and the setting is on. If not, `queued` goes back to `idle`.
 * - `ready`: every section has its vector.
 * - `failed`: the last preparation threw. What it embedded stays.
 *
 * Two inputs say the vectors are behind: `sectionsChanged` for one project,
 * `vectorsGone` for all of them (another model, a new index). Neither embeds
 * by itself. Embedding costs real time on a person's computer, so a project
 * prepares only when someone looks at it (`prepareVectors`). That is also
 * what tries a failed preparation again: there are no timers.
 *
 * Change detection, each layer for its own cost: the index's `files` row saves
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

type Project = {
	state: VectorPreparationState;
	/** While `preparing`: its sections or vectors changed, so it runs again. */
	behind: boolean;
	/** While `failed`: when it failed. */
	failedAt: number;
};

/** The states of the projects' vectors on this computer. */
export type VectorStates = ReturnType<typeof createVectorStates>;

/**
 * The states, and the one queue the preparations run in. `onEvent` hears
 * each change of a project's state.
 */
export function createVectorStates(
	onEvent?: (event: VectorPreparationEvent) => void,
) {
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

	/** The project moves to `to` at `at`. */
	function move(
		projectId: string,
		to: VectorPreparationState,
		at: number,
		error?: unknown,
	): void {
		const project = projectOf(projectId);
		const from = project.state;
		project.state = to;
		onEvent?.({
			projectId,
			from,
			to,
			at,
			...(error !== undefined ? { error } : {}),
		});
	}

	return {
		projectOf,
		move,
		/** Whether a request at `at` may queue the project: it is idle, or it failed `RETRY_MS` ago. */
		mayQueue(projectId: string, at: number): boolean {
			const project = projectOf(projectId);
			return (
				project.state === "idle" ||
				(project.state === "failed" && at - project.failedAt >= RETRY_MS)
			);
		},
		/** Runs `work` after the preparations before it. */
		enqueue(work: () => Promise<void>): void {
			queue = queue.then(work);
		},
		/** The project's sections changed at `at`: its vectors are behind. */
		sectionsChanged(projectId: string, at: number): void {
			const project = projectOf(projectId);
			if (project.state === "ready") move(projectId, "idle", at);
			else if (project.state === "preparing") project.behind = true;
		},
		/** Every project's vectors are behind at `at`, and a failure says nothing any more. */
		vectorsGone(at: number): void {
			for (const [projectId, project] of projects) {
				if (project.state === "ready" || project.state === "failed") {
					move(projectId, "idle", at);
				} else if (project.state === "preparing") {
					project.behind = true;
				}
			}
		},
		stateOf: (projectId: string): VectorPreparationState =>
			projects.get(projectId)?.state ?? "idle",
		/**
		 * What to log when the model's readiness changed: once per change, and
		 * not for a first `ready`. Null: nothing to say.
		 */
		heardReady(
			ready: KnowledgeMeaningReady,
			model: Pick<KnowledgeMeaning, "model" | "where">,
		): string | null {
			const changed =
				ready !== lastReady && (lastReady !== null || ready !== "ready");
			lastReady = ready;
			if (!changed) return null;
			return ready === "ready"
				? `Knowledge search finds by meaning again, with ${model.model}.`
				: ready === "downloading"
					? `Knowledge search finds by words only while ${model.model} downloads.`
					: ready === "no-model"
						? `Knowledge search finds by words only: Ollama does not have ${model.model}. Download it on the Settings page.`
						: `Knowledge search finds by words only: Ollama does not answer${model.where ? ` at ${model.where}` : " on this computer"}.`;
		},
	};
}

/** Whether the model can embed now. A change is logged once (`heardReady`). */
export async function readinessOf(
	model: Pick<KnowledgeMeaning, "model" | "where" | "ready">,
	states: Pick<VectorStates, "heardReady">,
	log: (line: string) => void,
): Promise<KnowledgeMeaningReady> {
	const ready = await model.ready();
	const line = states.heardReady(ready, model);
	if (line) log(line);
	return ready;
}

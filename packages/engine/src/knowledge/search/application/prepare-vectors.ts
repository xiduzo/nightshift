import { readinessOf, type VectorStates } from "../domain/vector-states";
import type { MeaningModel, SearchIndex, VectorIndexing } from "./ports";

export type PrepareVectorsPorts = {
	index: Pick<
		SearchIndex,
		| "isOpen"
		| "opening"
		| "vectorsFor"
		| "sectionsToEmbed"
		| "vectorModel"
		| "resetVectors"
	>;
	indexing: VectorIndexing;
	/** The model now: null once the search closed for good. */
	meaning: MeaningModel;
	/** Whether a person left search by meaning on for the project. Never throws. */
	meaningOn(projectId: string): Promise<boolean>;
	states: VectorStates;
	clock: () => number;
};

/** The project someone looks at. */
export type PrepareVectors = { projectId: string };

/**
 * Prepares the vectors of a project in the background, when someone looks
 * at it: its preparation goes in the queue, if it may (`mayQueue`). What may
 * start is read when the turn comes, not when the project is queued: the
 * queue can wait behind another project for a long time.
 */
export const prepareVectors = (ports: PrepareVectorsPorts) => {
	const { index, states, clock } = ports;

	function request({ projectId }: PrepareVectors): void {
		if (!ports.meaning.current() || !index.isOpen()) return;
		if (!states.mayQueue(projectId, clock())) return;
		states.move(projectId, "queued", clock());
		states.enqueue(() => prepare(projectId));
	}

	/**
	 * One preparation: embeds the sections that have no vector yet and drops
	 * the vectors of sections that went (`VectorIndexing`). An unchanged
	 * section costs a hash and a look-up, no embedding. Never throws.
	 */
	async function prepare(projectId: string): Promise<void> {
		const model = ports.meaning.current();
		// Closed meanwhile: a preparation does not open the index again.
		if (
			!model ||
			!index.isOpen() ||
			!(await ports.meaningOn(projectId)) ||
			(await readinessOf(model, states, console.info)) !== "ready" ||
			!index.isOpen()
		) {
			states.move(projectId, "idle", clock());
			return;
		}
		const project = states.projectOf(projectId);
		const opening = index.opening();
		try {
			// Before `behind` is cleared: a new model makes every project behind.
			index.vectorsFor(projectId, model);
			project.behind = false;
			states.move(projectId, "preparing", clock());
			await ports.indexing.index(
				projectId,
				model,
				index.sectionsToEmbed(projectId),
			);
			const nowModel = index.vectorModel();
			// The model changed while this one embedded: its vectors may be mixed in.
			if (nowModel !== null && nowModel !== model.model) {
				index.resetVectors(nowModel);
			}
		} catch (error) {
			// Closed while it ran, and maybe opened again since: its handles are
			// gone, and that is not a failure. The next look prepares again.
			if (!index.isOpen() || index.opening() !== opening) {
				states.move(projectId, "idle", clock());
				return;
			}
			project.failedAt = clock();
			console.warn(
				"Knowledge search could not prepare its search by meaning:",
				error,
			);
			states.move(projectId, "failed", clock(), error);
			return;
		}
		if (project.behind) {
			states.move(projectId, "idle", clock());
			request({ projectId });
			return;
		}
		states.move(projectId, "ready", clock());
	}

	return request;
};

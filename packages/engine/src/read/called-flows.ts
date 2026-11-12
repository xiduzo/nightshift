import type { Flow } from "@nightshift/flows";

/** What the walk reads of a step: its node, and the Call step it ran under. */
type ScopedStep = {
	id: string;
	nodeId: string;
	scope: { parentStepId: string } | null;
};

/** The run's copies of its flows: its own, and each flow it can call, by name. */
type FlowCopies = { flow: Flow; calledFlows: Record<string, Flow> };

/** The called flows of a run's steps (`calledFlows`). */
type CalledFlows<S> = {
	/**
	 * The called flow the step ran in: the flow its Call step calls. Null
	 * for a step of the run's own flow, and for one whose Call is unknown.
	 */
	ranIn(step: S): string | null;
	/**
	 * The flow a Call step calls: the one its node names, in the flow the
	 * step ran in. Null for any other step, or a node the copy lacks.
	 */
	calls(step: S): string | null;
};

/**
 * The called flows of a run's steps, from the run's copies of its flows.
 * `logged`: the name the log gave a Call step (`FlowCalled`), read before
 * the copies. `copies` is read only when a name is not logged, so a caller
 * may parse them on the first call. Each answer is kept, and a loop of
 * scopes ends with null.
 */
export function calledFlows<S extends ScopedStep>(
	steps: readonly S[],
	copies: () => FlowCopies,
	logged?: (step: S) => string | null,
): CalledFlows<S> {
	const byId = new Map(steps.map((step) => [step.id, step]));
	const names = new Map<string, string | null>();

	const parentOf = (step: S) =>
		step.scope ? byId.get(step.scope.parentStepId) : undefined;

	/** The copy of the flow the step's node is in. Undefined when it is not known. */
	const holder = (step: S): Flow | undefined => {
		if (step.scope === null) return copies().flow;
		const parent = parentOf(step);
		const name = parent ? calls(parent) : null;
		if (name === null) return undefined;
		const called = copies().calledFlows;
		return Object.hasOwn(called, name) ? called[name] : undefined;
	};

	function calls(step: S): string | null {
		const known = names.get(step.id);
		if (known !== undefined) return known;
		names.set(step.id, null);
		let name = logged?.(step) ?? null;
		if (name === null) {
			const node = holder(step)?.nodes.find((n) => n.id === step.nodeId);
			name = node?.type === "call" ? node.flow : null;
		}
		names.set(step.id, name);
		return name;
	}

	return {
		ranIn(step) {
			const parent = parentOf(step);
			return parent ? calls(parent) : null;
		},
		calls,
	};
}

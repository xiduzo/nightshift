/**
 * The guided setup as one path of four steps: connect an agent, choose a
 * model that decides, check that Night Shift's agents answer, add a
 * project. Pure: what is done comes from the profiles, the decider, the
 * check and the projects.
 */

/** A step of the setup. */
export type SetupPhase = "agent" | "decider" | "check" | "project";

/** The four steps in order, with the short name the step line shows. */
export const SETUP_PATH: readonly { phase: SetupPhase; label: string }[] = [
	{ phase: "agent", label: "Agent" },
	{ phase: "decider", label: "Model" },
	{ phase: "check", label: "Check" },
	{ phase: "project", label: "Project" },
];

/** Which steps are done. */
export type PathDone = Record<SetupPhase, boolean>;

/**
 * Which steps are done, from what this computer has. A model step that
 * cannot act here counts as done: the path does not stop on it.
 */
export function pathDone(facts: {
	/** The Agent Profiles of this computer. */
	profiles: number;
	/** The setup of a decider. Undefined: not loaded. */
	decider: { available: boolean; current: { chosen: boolean } } | undefined;
	/** Every one of Night Shift's agents answered its check. */
	checked: boolean;
	/** The projects. Undefined: not loaded. */
	projects: number | undefined;
}): PathDone {
	return {
		agent: facts.profiles > 0,
		decider:
			facts.decider !== undefined &&
			(facts.decider.current.chosen || !facts.decider.available),
		check: facts.checked,
		project: (facts.projects ?? 0) > 0,
	};
}

export type PathStep = {
	phase: SetupPhase;
	label: string;
	/** `current`: the step the dialog shows, done or not. */
	state: "done" | "current" | "todo";
	done: boolean;
};

/** The step line: each step, whether it is done, and where the person is. */
export function pathSteps(at: SetupPhase, done: PathDone): PathStep[] {
	return SETUP_PATH.map(({ phase, label }) => ({
		phase,
		label,
		done: done[phase],
		state: phase === at ? "current" : done[phase] ? "done" : "todo",
	}));
}

/**
 * The step after `after` that is still open. A person who skips a step
 * moves on the same way. Null: the path ends here.
 */
export function nextPhase(
	after: SetupPhase,
	done: PathDone,
): SetupPhase | null {
	const index = SETUP_PATH.findIndex((step) => step.phase === after);
	return (
		SETUP_PATH.slice(index + 1).find((step) => !done[step.phase])?.phase ?? null
	);
}

/** What the step line says to a screen reader: "Step 2 of 4: Model". */
export function stepLine(at: SetupPhase): string {
	const index = SETUP_PATH.findIndex((step) => step.phase === at);
	return `Step ${index + 1} of ${SETUP_PATH.length}: ${SETUP_PATH[index]?.label ?? ""}`;
}

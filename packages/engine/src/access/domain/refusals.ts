import { Refusal } from "@nightshift/refusal";

/**
 * The refusals of who may see or act on a run, or act in a Space. A run or
 * a Space the Person may not see is "not found", the same answer as one
 * that does not exist: the answer does not tell that it is there. A door
 * keeps its own words for each (section 4.4 of the run path plan): it maps
 * the refusal, it does not show these words.
 */

/** What a person reads for a run this Replica does not have, or one they may not see. The run log says the same (`RUN_NOT_FOUND` of `log/`). */
export const RUN_NOT_FOUND_WORDS = "Night Shift cannot find this run.";

/** What a person reads for a Space that does not exist, or one they are not a Member of. */
export const SPACE_NOT_FOUND_WORDS = "That Space does not exist.";

/** No run of that id here, or the Person may not see it. */
export class RunNotFound extends Refusal {
	constructor() {
		super("not-found", RUN_NOT_FOUND_WORDS);
		this.name = "RunNotFound";
	}
}

/** No Space of that id, or the Person is not a Member of it. */
export class SpaceNotFound extends Refusal {
	constructor() {
		super("not-found", SPACE_NOT_FOUND_WORDS);
		this.name = "SpaceNotFound";
	}
}

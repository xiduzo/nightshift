import type { Permissions } from "@nightshift/auth";
import type { AnswerFile } from "@nightshift/flows";
import type { PersonActor } from "../../contract";
import type { AnsweredGate, OpenGate } from "../../read";

/**
 * The driven ports of the Gates. One is their own, with a real adapter,
 * an in-memory adapter and a contract suite in `adapters/out/`:
 * `MemberSpaces`. Another slice fills the others (`@filledBy`): the
 * engine's composition passes them to `wireGates`.
 */

/**
 * The open and the answered Gates of one Space, as the views of its runs
 * show them.
 * @filledBy engine/runs
 */
export type GateLists = {
	/** The open Gates of the Space's runs, oldest first. `answerPending` says an answer is on its way. */
	open(spaceId: string): Promise<OpenGate[]>;
	/** The Gates of the Space's runs that closed after `since`, newest first. */
	answered(spaceId: string, since: number): Promise<AnsweredGate[]>;
};

/**
 * Where the Walker keeps the files of an answer: artifacts of the run and
 * the step.
 * @filledBy engine/artifacts
 */
export type AnswerFiles = {
	save(answer: {
		runId: string;
		stepId: string;
		files: readonly AnswerFile[];
	}): Promise<void>;
};

/** The Spaces a Person is a Member of on this Replica. */
export type MemberSpaces = {
	/** Each Space of the Person, with its name and whether their role there allows `need`. */
	of(
		person: PersonActor,
		need: Permissions,
	): Promise<{ id: string; name: string; allowed: boolean }[]>;
};

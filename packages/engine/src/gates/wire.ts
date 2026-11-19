import { askAnswerProblem } from "../graph";
import { inboxOrder } from "../read";
import type { Access, Walk } from "../runs";
import {
	type AuthMemberSpacesDeps,
	authMemberSpaces,
} from "./adapters/out/auth-member-spaces";
import { answerGate } from "./application/answer-gate";
import { listAnsweredGates } from "./application/list-answered-gates";
import { listAnsweredInbox } from "./application/list-answered-inbox";
import { listInbox } from "./application/list-inbox";
import { listOpenGates } from "./application/list-open-gates";
import type { AnswerFiles, GateLists } from "./application/ports";

/**
 * The wiring of the Gates: the one place that builds their real adapter
 * (the Spaces of a Person over `@nightshift/auth`) and binds each use case
 * to its ports. The ports an answer shares with every action on a run come
 * from `runs/walk`, the check of who may act from `runs/access`.
 */

/** What the engine gives the Gates: the runs' access and walk, and what the ports stand on. */
export type GatesDeps = {
	access: Pick<Access, "openRun" | "openSpace">;
	walk: Pick<Walk, "facts" | "turns" | "walkers">;
	/** The Spaces of a Person: this Replica's `member` rows. */
	members: AuthMemberSpacesDeps;
	/** The open and the answered Gates of a Space (the views of its runs). */
	gates: GateLists;
	/** Where the Walker keeps the files of an answer (the artifacts). */
	files: AnswerFiles;
	/** The time now. */
	now(): number;
	/** Whether the answer applies the lock-screen rule (`answerGate`). */
	checksLockScreen: boolean;
};

/** The use cases of the Gates, bound to their ports. */
export type Gates = {
	/** Answers a run's open Gate, as the actor. */
	answerGate: ReturnType<typeof answerGate>;
	/** The open Gates of one Space. */
	listOpenGates: ReturnType<typeof listOpenGates>;
	/** The Gates of one Space that closed after a moment. */
	listAnsweredGates: ReturnType<typeof listAnsweredGates>;
	/** The Needs-you inbox of a Person: every Space they are a Member of. */
	listInbox: ReturnType<typeof listInbox>;
	/** The answered part of a Person's inbox. */
	listAnsweredInbox: ReturnType<typeof listAnsweredInbox>;
};

export function wireGates(deps: GatesDeps): Gates {
	const { access, walk, gates, now } = deps;
	const spaces = authMemberSpaces(deps.members);
	return {
		answerGate: answerGate({
			openRun: access.openRun,
			facts: walk.facts,
			turns: walk.turns,
			walkers: walk.walkers,
			gates,
			files: deps.files,
			askProblem: askAnswerProblem,
			checksLockScreen: deps.checksLockScreen,
		}),
		listOpenGates: listOpenGates({ openSpace: access.openSpace, gates }),
		listAnsweredGates: listAnsweredGates({
			openSpace: access.openSpace,
			gates,
		}),
		listInbox: listInbox({ spaces, gates, inboxOrder }),
		listAnsweredInbox: listAnsweredInbox({ spaces, gates, now }),
	};
}

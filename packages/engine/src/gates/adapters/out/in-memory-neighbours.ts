import type { AnswerFile } from "@nightshift/flows";
import { askAnswerProblem } from "../../../graph";
import { foldRun, type RunState } from "../../../log";
import { type AnsweredGate, inboxOrder, type OpenGate } from "../../../read";
import {
	runRecord,
	THIS_COMPUTER,
} from "../../../runs/access/adapters/out/in-memory-run-records";
import { inMemoryAccessPorts } from "../../../runs/access/adapters/out/in-memory-space-members";
import {
	openRun,
	type RunRecord,
} from "../../../runs/access/application/open-run";
import { openSpace } from "../../../runs/access/application/open-space";
import { inMemoryRunFacts } from "../../../runs/walk/adapters/out/in-memory-run-facts";
import { inMemoryTurns } from "../../../runs/walk/adapters/out/in-memory-turns";
import { inMemoryWalkers } from "../../../runs/walk/adapters/out/in-memory-walkers";
import type { AnswerFiles, GateLists } from "../../application/ports";
import { inMemoryMemberSpaces } from "./in-memory-member-spaces";

/**
 * The in-memory adapters of the ports that another slice fills
 * (`@filledBy` in `application/ports.ts`), and `inMemoryGatePorts`, which
 * gives a use-case test every port of the Gates at once. Test code:
 * production code never imports this file.
 */

/** The open and the answered Gates of Spaces, as a test sets them. */
export function inMemoryGateLists() {
	const open = new Map<string, OpenGate[]>();
	const answered = new Map<string, AnsweredGate[]>();
	const twin = {
		/** Every Space whose Gates were read, in order. */
		asked: [] as string[],
		/** The open Gates of a Space from now on, in the order given. */
		setOpen(spaceId: string, gates: OpenGate[]) {
			open.set(spaceId, gates);
		},
		/** The answered Gates of a Space from now on. */
		setAnswered(spaceId: string, gates: AnsweredGate[]) {
			answered.set(spaceId, gates);
		},
		async open(spaceId: string) {
			twin.asked.push(spaceId);
			return open.get(spaceId) ?? [];
		},
		async answered(spaceId: string, since: number) {
			twin.asked.push(spaceId);
			return (answered.get(spaceId) ?? []).filter((g) => g.closedAt > since);
		},
	};
	return twin satisfies GateLists;
}

/** The files of answers in memory: each save, in order. */
export function inMemoryAnswerFiles() {
	const twin = {
		saved: [] as {
			runId: string;
			stepId: string;
			files: readonly AnswerFile[];
		}[],
		async save(answer: {
			runId: string;
			stepId: string;
			files: readonly AnswerFile[];
		}) {
			twin.saved.push(answer);
		},
	};
	return twin satisfies AnswerFiles;
}

/** The Space every run of a test is in, unless it says another. */
export const SPACE = "space-1";
/** A Person who is a Member of `SPACE`, and one who only views it. */
export const ADA = { personId: "person-ada", door: "session" as const };
export const VIC = { personId: "person-vic", door: "session" as const };
/** The Device that walks a run walked elsewhere. */
export const FAR = "device-far";

/** A run's state for a test: the fold of an empty log, with the fields the test names. */
export function stateOf(fields: Partial<RunState>): RunState {
	return { ...foldRun([]), ...fields };
}

/** An open Gate of a run in a Space, opened at `openedAt`. */
export function openGate(
	spaceId: string,
	runId: string,
	openedAt: number,
	stepId = `step-${runId}`,
): OpenGate {
	return {
		spaceId,
		runId,
		runTitle: `Run ${runId}`,
		flowName: null,
		projectId: `project-${runId}`,
		projectName: "Project",
		stepId,
		nodeId: "ship",
		question: "Ship it?",
		choices: [{ name: "yes" }, { name: "no" }],
		urgency: "today",
		brief: {
			urgencyBy: "default",
			situation: null,
			background: [],
			recommendation: null,
			byModel: [],
		},
		lockScreen: false,
		openedAt,
		deadline: null,
		form: null,
		walker: { id: "device", name: "test", thisDevice: true },
		answerPending: false,
		branchesWork: false,
	};
}

/**
 * Every port of the Gates in memory at once, with the pure functions of
 * the mechanisms they take: where each use-case test starts. `ADA` is a
 * member of `SPACE`, `VIC` a viewer. A test puts a run in (`put`) with its
 * state: the run's facts read that state, and its Turns check it.
 */
export function inMemoryGatePorts(
	options: { reachable?: boolean; now?: number } = {},
) {
	const access = inMemoryAccessPorts(THIS_COMPUTER);
	access.members.join(SPACE, ADA.personId, "member");
	access.members.join(SPACE, VIC.personId, "viewer");
	const states = new Map<string, RunState>();
	const twin = inMemoryRunFacts(THIS_COMPUTER);
	const facts = {
		...twin,
		/** The state `put` set, else the fold of what was appended. */
		state: async (runId: string) => states.get(runId) ?? twin.state(runId),
	};
	const turns = inMemoryTurns();
	let at = options.now ?? 0;
	return {
		...access,
		openRun: openRun(access),
		openSpace: openSpace(access),
		facts,
		turns,
		walkers: inMemoryWalkers(options),
		gates: inMemoryGateLists(),
		files: inMemoryAnswerFiles(),
		spaces: inMemoryMemberSpaces(),
		askProblem: askAnswerProblem,
		inboxOrder,
		now: () => at,
		/** The time from now on. */
		setNow(next: number) {
			at = next;
		},
		/**
		 * Puts a run in: its row (walked here unless `walkerId` says
		 * another Device), its state, and whether a drive holds it.
		 */
		put(
			run: Pick<RunRecord, "id"> & Partial<RunRecord>,
			state: RunState = stateOf({ status: "waiting" }),
			active = false,
		): RunRecord {
			const row = runRecord({ spaceId: SPACE, ...run });
			access.runs.add(row);
			states.set(row.id, state);
			turns.set(row.id, { row, runState: state, active });
			return row;
		},
	};
}

export type InMemoryGatePorts = ReturnType<typeof inMemoryGatePorts>;

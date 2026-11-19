import {
	type Actor,
	type RunActionRequest,
	type RunCommandInput,
	requestOf,
} from "../../../contract";
import type { markRunUseful } from "./mark-run-useful";
import type { recordTakeOver } from "./record-take-over";
import type { releaseLease } from "./release-lease";
import type { rerunFromNode } from "./rerun-from-node";
import type { restartStep } from "./restart-step";
import type { resumeRun } from "./resume-run";
import type { sendSignal } from "./send-signal";
import type { stopRun } from "./stop-run";

/** The fields of the action of `kind`, without its kind, for the run it is on. */
type OnRun<K extends RunActionRequest["kind"]> = {
	runId: string;
	spaceId?: string;
} & Omit<Extract<RunActionRequest, { kind: K }>, "kind">;

/**
 * Each action as its own use case, bound to its ports: each opens the run
 * for the actor with the permission the action needs. An answer is the
 * path of `run/answer.ts` until lane R6 makes it a use case of `gates/`. A
 * move is `moveRun` of `runs/move/`.
 */
export type ActOnRunPorts = {
	stop: ReturnType<typeof stopRun>;
	useful: ReturnType<typeof markRunUseful>;
	signal: ReturnType<typeof sendSignal>;
	releaseLease: ReturnType<typeof releaseLease>;
	resume: ReturnType<typeof resumeRun>;
	restart: ReturnType<typeof restartStep>;
	rerun: ReturnType<typeof rerunFromNode>;
	takeOver: ReturnType<typeof recordTakeOver>;
	/** Answers the run's open Gate (`run/answer.ts`). */
	answer(actor: Actor, request: OnRun<"answer">): Promise<void>;
	/** Moves the run's walk to another of the Person's Devices (`runs/move/`). */
	move(actor: Actor, request: OnRun<"move">): Promise<void>;
};

/** The run, the Space the caller works in, and the action in the person's words or as its Command. */
export type ActOnRun = {
	runId: string;
	/** The Space the caller works in. A run of another Space is not found. */
	spaceId?: string;
	action: RunActionRequest | RunCommandInput;
};

/**
 * Does what the action asks of the run, as the actor: here as a Turn of
 * the runner, or on another Walker as a Command. The action comes in the
 * person's words, or as the Command that carried it to this Walker
 * (`contract/command.ts`, the one home of the kinds). Each action is its
 * own use case: this hands the action to it as it came.
 */
export const actOnRun =
	(ports: ActOnRunPorts) =>
	async (actor: Actor, request: ActOnRun): Promise<void> => {
		const on = { runId: request.runId, spaceId: request.spaceId };
		const action = requestOf(request.action);
		switch (action.kind) {
			case "stop": {
				const { kind: _, ...fields } = action;
				return ports.stop(actor, { ...on, ...fields });
			}
			case "answer": {
				const { kind: _, ...fields } = action;
				return ports.answer(actor, { ...on, ...fields });
			}
			case "useful": {
				const { kind: _, ...fields } = action;
				return ports.useful(actor, { ...on, ...fields });
			}
			case "signal": {
				const { kind: _, ...fields } = action;
				return ports.signal(actor, { ...on, ...fields });
			}
			case "move": {
				const { kind: _, ...fields } = action;
				return ports.move(actor, { ...on, ...fields });
			}
			case "release-lease": {
				const { kind: _, ...fields } = action;
				return ports.releaseLease(actor, { ...on, ...fields });
			}
			case "resume": {
				const { kind: _, ...fields } = action;
				return ports.resume(actor, { ...on, ...fields });
			}
			case "restart": {
				const { kind: _, ...fields } = action;
				return ports.restart(actor, { ...on, ...fields });
			}
			case "rerun": {
				const { kind: _, ...fields } = action;
				return ports.rerun(actor, { ...on, ...fields });
			}
			case "take-over":
				return ports.takeOver(actor, on);
		}
	};

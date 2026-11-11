import type { Permissions } from "@nightshift/auth";
import { runCommand } from "@nightshift/db/schema";
import {
	type AnswerFile,
	answerFilesSchema,
	type JsonValue,
	labelSchema,
} from "@nightshift/flows";
import { z } from "zod";

/**
 * The Command: what a person asks of a run, and how it travels to the
 * run's Walker when another Device walks it. One module names the actions
 * (`RunActionRequest`, the person's words), which of them travel and as
 * what (`RunCommandInput`, the wire's words), the permission each needs
 * in the run's Space (`permissionOf`) and the shape a Command has on the
 * wire and in the Host's row (`runCommandSchema`). `SpaceEngine.act`
 * takes either shape (`run/actions.ts`): here as a Turn of the runner,
 * or on the Walker elsewhere through the Relay.
 *
 * The stored kinds are the db schema's (`run_command.kind`): the one
 * list, read here, that the actions below cover. Adding a kind is that
 * enum, a member of `RunActionRequest`, its row in the two tables, its
 * payload schema, and what `act` does with it.
 */

/** The kinds of Command a Host keeps, as the schema stores them. */
export const COMMAND_KINDS = runCommand.kind.enumValues;

/** What a Command does, on the wire and in the Host's row. */
export type RunCommandKind = (typeof COMMAND_KINDS)[number];

/** Where an answer to a Gate came from. The log's `GateVia`, in the words the wire knows. */
type AnswerVia = "web" | "phone" | "lock_screen" | "_OTHER";

/** One action a person asks of a run (`SpaceEngine.act`). */
export type RunActionRequest =
	/**
	 * `now` (default): aborts the running step, closes an open Gate or ends
	 * a sleep, and ends the run as `stopped`. `after-step`: lets the running
	 * step finish, then ends the run as `stopped` before the next step.
	 * `cancel-after-step`: withdraws an `after-step` stop. No-op when
	 * nothing runs, waits or sleeps.
	 */
	| { kind: "stop"; when?: "now" | "after-step" | "cancel-after-step" }
	/**
	 * Answers an open Gate with one of its choices and continues the walk
	 * on that outcome. Fails when the step is not an open Gate or the
	 * choice is not one of its choices. An Ask (ADR 10) takes `data`, the
	 * data of its form: it fails when the data does not match the form.
	 * `files` go with the answer: the Walker keeps them with the run's
	 * artifacts, and each agent session of the run after it gets them.
	 */
	| {
			kind: "answer";
			stepId: string;
			choice: string;
			note?: string;
			data?: JsonValue;
			files?: AnswerFile[];
			/** Where the answer came from. Absent stores `_OTHER`. */
			via?: AnswerVia;
	  }
	/**
	 * Records whether you found this run useful: the score `useful` on
	 * the run. One tap. A later tap replaces it.
	 */
	| { kind: "useful"; useful: boolean }
	/**
	 * A signal to a run whose Wait node waits for it: the step ends `done`
	 * and the walk goes on. Fails when the run does not wait for a signal
	 * of that name.
	 */
	| { kind: "signal"; name: string }
	/**
	 * Moves the run's Walk to another of the actor's Devices
	 * (`WalkerMoved`): this computer archives the run's checkpoint and
	 * files and stops walking it; the new Walker resumes from the archive.
	 * Only a run that is not in the middle of a step.
	 */
	| { kind: "move"; to: string }
	/**
	 * Lets go of the lease `name` that the run holds (ADR 7): the next run
	 * that waits for it takes it. The run goes on, and does not take it
	 * again. Fails when the run does not hold it.
	 */
	| { kind: "release-lease"; name: string }
	/**
	 * Continues a stopped, failed or interrupted run at its last step's
	 * node (inside a Call with `each`, at the same item). A finished run
	 * reopens its last step. A sleeping run wakes at once. An Agent node
	 * with a harness session continues that session with the prompt
	 * (default "Continue where you left off."). Any other node runs again.
	 * Edge counts carry over. Fails while the run is running.
	 */
	| { kind: "resume"; prompt?: string }
	/**
	 * Stops the running step and continues it at once, as a stop now and a
	 * resume would, with nothing in between. Only while a step runs; with
	 * `stepId`, only while that step runs.
	 */
	| { kind: "restart"; stepId?: string; prompt?: string }
	/**
	 * Walks a run that is not going (failed, stopped, interrupted or
	 * finished) again from `nodeId`, a node of the run's own flow, with a
	 * new visit of it; the steps after it follow as the flow routes.
	 * Inputs, outputs and edge counts carry over. An Agent node continues
	 * the session of its step `stepId` (default: its latest) with the
	 * prompt, or with `fresh` starts a new session with its own prompt.
	 */
	| {
			kind: "rerun";
			nodeId: string;
			stepId?: string;
			prompt?: string;
			fresh?: boolean;
	  }
	/**
	 * A person took the run over by hand: they copied or shared the command
	 * that opens its last harness session. The Walker logs it
	 * (`RunTakenOver`), once per step and person in a walk. The run goes on
	 * as it was. A screen offers it only where the run is walked.
	 */
	| { kind: "take-over" };

/** The name of an action, in the person's words. */
export type RunActionKind = RunActionRequest["kind"];

/**
 * The Command kind that carries each action to the Walker of a run
 * another Device walks. Null: only the Walker takes it (`run-status/`
 * refuses it elsewhere as `walked-elsewhere`).
 */
const COMMAND_OF = {
	stop: "run.stop",
	answer: "gate.resolve",
	useful: "run.useful",
	signal: "signal.send",
	move: "run.move",
	"release-lease": "lease.release",
	resume: "run.resume",
	restart: null,
	rerun: null,
	"take-over": null,
} as const satisfies Record<RunActionKind, RunCommandKind | null>;

/**
 * The permission each action needs in the run's Space. The API checks it
 * for a session, the Host for a Device's Person, and the Walker again
 * before it applies a Command.
 */
const NEEDS: Record<RunActionKind, Permissions> = {
	stop: { run: ["stop"] },
	answer: { gate: ["resolve"] },
	// Scoring a run's pull request, and letting go of a lease, cut into the run as a stop does.
	useful: { run: ["stop"] },
	signal: { signal: ["send"] },
	move: { run: ["move"] },
	"release-lease": { run: ["stop"] },
	resume: { run: ["resume"] },
	restart: { run: ["stop", "resume"] },
	rerun: { run: ["resume"] },
	// Taking a run over by hand continues it, as a resume does.
	"take-over": { run: ["resume"] },
};

/** The action each Command kind carries: `COMMAND_OF` read the other way. */
const ACTION_OF = Object.fromEntries(
	Object.entries(COMMAND_OF).flatMap(([action, kind]) =>
		kind === null ? [] : [[kind, action]],
	),
) as Record<RunCommandKind, RunActionKind>;

/**
 * A Command: an action that travels, as the wire and the Host's row hold
 * it. Its payload is the request without its kind, so the Walker takes
 * it as the request it was.
 */
export type RunCommandInput = {
	[A in RunActionKind]: (typeof COMMAND_OF)[A] extends infer K extends
		RunCommandKind
		? {
				kind: K;
				payload: Omit<Extract<RunActionRequest, { kind: A }>, "kind">;
			}
		: never;
}[RunActionKind];

/** The payload of a Command of `kind`. */
type PayloadOf<K extends RunCommandKind> = Extract<
	RunCommandInput,
	{ kind: K }
>["payload"];

/** An answer to a Gate, on its way to the Walker. Named, so the declared types stay small. */
export type GateResolvePayload = PayloadOf<"gate.resolve">;

/** Whether `kind` names a Command (the wire's words) and not an action (the person's). */
function isCommandKind(kind: string): kind is RunCommandKind {
	return kind in ACTION_OF;
}

/** The permission an action needs in the run's Space, by either of its names. */
export function permissionOf(
	kind: RunActionKind | RunCommandKind,
): Permissions {
	return NEEDS[isCommandKind(kind) ? ACTION_OF[kind] : kind];
}

/**
 * The Command that carries `request` to the Walker of a run another
 * Device walks, or null for an action only the Walker takes.
 */
export function commandOf(request: RunActionRequest): RunCommandInput | null {
	const kind = COMMAND_OF[request.kind];
	if (kind === null) return null;
	const { kind: _, ...fields } = request;
	// A field that is not set stays off the wire and out of the row.
	const payload = Object.fromEntries(
		Object.entries(fields).filter(([, value]) => value !== undefined),
	);
	return { kind, payload } as RunCommandInput;
}

/**
 * The action as `act` takes it: a request as it is, or the one its
 * Command carries (a Command that reached its Walker).
 */
export function requestOf(
	action: RunActionRequest | RunCommandInput,
): RunActionRequest {
	if (!isCommandKind(action.kind)) return action as RunActionRequest;
	const { kind, payload } = action as RunCommandInput;
	return { kind: ACTION_OF[kind], ...payload } as RunActionRequest;
}

/**
 * The payload of each Command kind on the wire, as a Device sends it and
 * a Host keeps it: what an older Device sends stays valid.
 */
const payloads: { [K in RunCommandKind]: z.ZodType<PayloadOf<K>> } = {
	"gate.resolve": z.object({
		stepId: z.string().min(1),
		choice: z.string().min(1),
		note: z.string().optional(),
		/** The answer to an Ask (ADR 10): the data of its form. */
		data: z.json().optional(),
		files: answerFilesSchema.optional(),
		via: z.enum(["web", "phone", "lock_screen", "_OTHER"]).optional(),
	}),
	"signal.send": z.object({ name: labelSchema }),
	"run.stop": z.object({
		when: z.enum(["now", "after-step", "cancel-after-step"]).optional(),
	}),
	"run.move": z.object({ to: z.string().min(1).max(64) }),
	"run.resume": z.object({ prompt: z.string().min(1).optional() }),
	"lease.release": z.object({ name: z.string().min(1).max(500) }),
	"run.useful": z.object({ useful: z.boolean() }),
};

/**
 * A Command on the wire: its kind and payload, with the fields its
 * carrier adds (`runId` on a Device's call, the row's fields in a batch
 * from the Host). One shape for every Device version.
 */
export function runCommandSchema<F extends z.ZodRawShape>(fields: F) {
	return z.discriminatedUnion("kind", [
		z.object({
			...fields,
			kind: z.literal("gate.resolve"),
			payload: payloads["gate.resolve"],
		}),
		z.object({
			...fields,
			kind: z.literal("signal.send"),
			payload: payloads["signal.send"],
		}),
		z.object({
			...fields,
			kind: z.literal("run.stop"),
			payload: payloads["run.stop"],
		}),
		z.object({
			...fields,
			kind: z.literal("run.move"),
			payload: payloads["run.move"],
		}),
		z.object({
			...fields,
			kind: z.literal("run.resume"),
			payload: payloads["run.resume"],
		}),
		z.object({
			...fields,
			kind: z.literal("lease.release"),
			payload: payloads["lease.release"],
		}),
		z.object({
			...fields,
			kind: z.literal("run.useful"),
			payload: payloads["run.useful"],
		}),
	]);
}

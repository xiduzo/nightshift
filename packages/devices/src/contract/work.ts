import type { DecisionInput, ValueInput } from "@nightshift/agents/types";
import type {
	CapabilityQuery,
	ExecInput,
	OfferedSessionInput,
	RunRef,
	SessionInput,
	ToolCallInput,
} from "@nightshift/engine";
import { z } from "zod";

/**
 * The wire of the work relay: a call of the Device port as plain data
 * (`WorkRequest`), the answers of the placed Device (`WorkReply`), what a
 * placed Device takes from its Host (`WorkDelivery`), and the transport
 * (`WorkRelay`). `work/` makes and serves the calls.
 */

/** Who asks a placed Device for work, and for which run. */
export type WorkFor = {
	spaceId: string;
	projectId: string;
	/** The Person who starts (or started) the run, as the Host knows them. */
	personId: string;
	/** Null before the run exists: its start asks for capabilities and flows first. */
	runId: string | null;
};

/** One call of the Device port, as plain data. */
export type WorkCall =
	| { kind: "capabilities"; query: CapabilityQuery }
	| { kind: "flows" }
	| { kind: "worktree"; run: RunRef }
	| { kind: "files"; cwd: string; glob: string }
	| {
			kind: "itemBranch";
			cwd: string;
			name: string;
			base: string | null;
			fallback: string;
	  }
	| { kind: "handOff"; cwd: string; runBranch: string }
	| { kind: "receiveHandOff"; run: RunRef; branch: string; commit: string }
	| {
			kind: "session";
			input: Omit<SessionInput, "signal"> | Omit<OfferedSessionInput, "signal">;
	  }
	| { kind: "exec"; input: Omit<ExecInput, "signal"> }
	| { kind: "callTool"; input: Omit<ToolCallInput, "signal"> }
	| {
			kind: "decide";
			input: Omit<DecisionInput, "signal"> | Omit<ValueInput, "signal">;
	  };

export type WorkRequest = WorkFor & { call: WorkCall };

export const WORK_KINDS = [
	"capabilities",
	"flows",
	"worktree",
	"files",
	"itemBranch",
	"handOff",
	"receiveHandOff",
	"session",
	"exec",
	"callTool",
	"decide",
] as const satisfies readonly WorkCall["kind"][];

/**
 * A request as the placed Device reads it: the checked part strictly, the
 * call's input as the Device port types it (the local Device reads it as
 * it would a local call).
 */
export const workRequestSchema = z.object({
	spaceId: z.string().min(1),
	projectId: z.string().min(1),
	personId: z.string().min(1),
	runId: z.string().min(1).nullable(),
	call: z.looseObject({ kind: z.enum(WORK_KINDS) }),
});

/** One answer of a placed Device to a call. */
export type WorkReply =
	/** One item of a streaming call: a `SessionEvent` or an `ExecEvent`. */
	| { kind: "item"; item: unknown }
	/** The answer of a call that answers once. */
	| { kind: "result"; value: unknown }
	/**
	 * The call failed or was refused there; the message is for people.
	 * `offline`: the Device could not be reached, or went away mid-call.
	 */
	| { kind: "error"; message: string; offline?: boolean };

export const workReplySchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("item"), item: z.unknown() }),
	z.object({ kind: z.literal("result"), value: z.unknown() }),
	z.object({
		kind: z.literal("error"),
		message: z.string(),
		offline: z.boolean().optional(),
	}),
]);

/** How the Walker reaches a placed Device. */
export type WorkRelay = {
	/**
	 * Sends one call and streams its replies. Aborting `signal` cancels the
	 * call on the Device and ends the stream. A Device that cannot be
	 * reached answers with an error.
	 */
	call(
		deviceId: string,
		request: WorkRequest,
		signal?: AbortSignal,
	): AsyncIterable<WorkReply>;
	/** Whether the Device takes work now, for a run of that Space. */
	online(deviceId: string, spaceId: string): boolean | Promise<boolean>;
};

/** What a placed Device takes from its Host: a call to serve, or one to cancel. */
export type WorkDelivery =
	| { kind: "call"; id: string; request: WorkRequest }
	| { kind: "cancel"; id: string };

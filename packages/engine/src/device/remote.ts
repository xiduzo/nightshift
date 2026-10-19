import type {
	DecisionInput,
	DecisionResult,
	ValueInput,
	ValueResult,
} from "@nightshift/agents/types";
import type { FlowSources } from "@nightshift/flows/files";
import { z } from "zod";

import type {
	Capabilities,
	CapabilityQuery,
	Device,
	ExecEvent,
	ExecInput,
	OfferedSessionInput,
	RunRef,
	SessionEvent,
	SessionInput,
	ToolCallInput,
	ToolResult,
	Worktree,
} from "./types";

/**
 * Another Device as a Device: `remoteDevice(relay, device, forRun)` makes
 * the port's calls through the Host to that Device's daemon, which serves
 * them with its own `localDevice` (`serveWork`). The Walker's step runner
 * cannot tell the two apart.
 *
 * The wire is plain data. A call is a `WorkRequest`: who asks and for which
 * run (`WorkFor`, what the placed Device checks before it starts anything),
 * and the call with its input, without the signal. The answer is a stream
 * of `WorkReply`: the items of a streaming call (`session`, `exec`), or one
 * result, or an error. Aborting the caller's signal cancels the call on
 * the placed Device: its session or command ends there.
 *
 * The transport is a `WorkRelay`. On a Host it is the hub the placed
 * Device pulls its work from over its own Link (`devices.work`): the Host
 * never dials a Device.
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

/** A placed Device that went quiet in the middle of a call. */
function stopped(name: string): string {
	return `${name} stopped answering before the step ended.`;
}

/** Another Device, reached through `relay`, working for one run (or its start). */
export function remoteDevice(
	relay: WorkRelay,
	device: { id: string; name: string },
	forRun: WorkFor,
): Device {
	const ask = (call: WorkCall, signal?: AbortSignal, projectId?: string) =>
		relay.call(
			device.id,
			{ ...forRun, ...(projectId ? { projectId } : {}), call },
			signal,
		);

	/** The one result of a call; throws its error. */
	async function once<T>(call: WorkCall, signal?: AbortSignal): Promise<T> {
		for await (const reply of ask(call, signal)) {
			if (reply.kind === "result") return reply.value as T;
			if (reply.kind === "error") throw new Error(reply.message);
		}
		throw new Error(stopped(device.name));
	}

	async function* session(
		input: SessionInput | OfferedSessionInput,
	): AsyncGenerator<SessionEvent> {
		const { signal, ...rest } = input;
		let started = false;
		let ended = false;
		for await (const reply of ask({ kind: "session", input: rest }, signal)) {
			if (reply.kind === "error") {
				// A Device that went away mid-session: a network kind lets the
				// run's policy wait for it and continue the harness session.
				yield started
					? {
							type: "error",
							kind: signal.aborted
								? "aborted"
								: reply.offline
									? "network"
									: "harness",
							message: reply.message,
						}
					: { type: "refused", message: reply.message };
				return;
			}
			if (reply.kind !== "item") continue;
			const event = reply.item as SessionEvent;
			if (event.type === "ready" || event.type === "refused") started = true;
			if (event.type === "finished" || event.type === "error") ended = true;
			yield event;
		}
		if (ended) return;
		// The stream ended without its last event: cancelled here, or the
		// Device went away. A network kind lets the run's policy wait for it.
		const message = signal.aborted
			? "The session was stopped."
			: stopped(device.name);
		if (!started) {
			yield { type: "refused", message };
			return;
		}
		yield {
			type: "error",
			kind: signal.aborted ? "aborted" : "network",
			message,
		};
	}

	async function* exec(input: ExecInput): AsyncGenerator<ExecEvent> {
		const { signal, ...rest } = input;
		for await (const reply of ask({ kind: "exec", input: rest }, signal)) {
			if (reply.kind === "error") {
				yield { type: "exit", exitCode: null, spawnError: reply.message };
				return;
			}
			if (reply.kind !== "item") continue;
			const event = reply.item as ExecEvent;
			yield event;
			if (event.type === "exit") return;
		}
		// Killed by a stop here, or the Device went away.
		yield {
			type: "exit",
			exitCode: null,
			spawnError: signal.aborted ? null : stopped(device.name),
		};
	}

	function decide(input: DecisionInput): Promise<DecisionResult>;
	function decide(input: ValueInput): Promise<ValueResult>;
	async function decide(
		input: DecisionInput | ValueInput,
	): Promise<DecisionResult | ValueResult> {
		const { signal, ...rest } = input;
		try {
			return await once({ kind: "decide", input: rest }, signal);
		} catch (error) {
			return {
				kind: "error",
				errorKind: signal.aborted ? "aborted" : "harness",
				message: error instanceof Error ? error.message : String(error),
				costUsd: null,
			};
		}
	}

	return {
		id: device.id,
		name: device.name,
		state: async () => ({
			online: await relay.online(device.id, forRun.spaceId),
		}),
		async capabilities(query = {}) {
			const has = await once<Capabilities>({ kind: "capabilities", query });
			return { ...has, elsewhere: device.name };
		},
		flows: async (projectId) => {
			for await (const reply of ask({ kind: "flows" }, undefined, projectId)) {
				if (reply.kind === "result") return reply.value as FlowSources;
				if (reply.kind === "error") throw new Error(reply.message);
			}
			throw new Error(stopped(device.name));
		},
		session,
		exec,
		async callTool(input): Promise<ToolResult> {
			const { signal, ...rest } = input;
			try {
				return await once<ToolResult>(
					{ kind: "callTool", input: rest },
					signal,
				);
			} catch (error) {
				return {
					kind: "failed",
					message: error instanceof Error ? error.message : String(error),
					arguments: null,
				};
			}
		},
		decide,
		worktree: (run) => once<Worktree>({ kind: "worktree", run }),
		files: (input) => once<string[]>({ kind: "files", ...input }),
		handOff: (input) =>
			once<{ commit: string; branch: string }>({ kind: "handOff", ...input }),
		receiveHandOff: (input) =>
			once<Worktree>({ kind: "receiveHandOff", ...input }),
		itemBranch: (input) =>
			once<{ branch: string; base: string }>({ kind: "itemBranch", ...input }),
	};
}

/**
 * Serves one call on this computer's Device, as the placed Device does
 * for a Walker elsewhere: after its own checks (the caller's), the local
 * Device answers as it would a local call. Never throws: a failure is an
 * `error` reply. Aborting `signal` ends a session or a command here.
 */
export async function* serveWork(
	device: Device,
	request: WorkRequest,
	signal: AbortSignal,
): AsyncGenerator<WorkReply> {
	const { call } = request;
	const result = (value: unknown): WorkReply => ({ kind: "result", value });
	try {
		switch (call.kind) {
			case "capabilities":
				yield result(await device.capabilities(call.query));
				return;
			case "flows":
				yield result(await device.flows(request.projectId));
				return;
			case "worktree":
				yield result(await device.worktree(call.run));
				return;
			case "files":
				yield result(await device.files({ cwd: call.cwd, glob: call.glob }));
				return;
			case "itemBranch":
				yield result(
					await device.itemBranch({
						cwd: call.cwd,
						name: call.name,
						base: call.base,
						fallback: call.fallback,
					}),
				);
				return;
			case "handOff":
				yield result(
					await device.handOff({ cwd: call.cwd, runBranch: call.runBranch }),
				);
				return;
			case "receiveHandOff":
				yield result(
					await device.receiveHandOff({
						run: call.run,
						branch: call.branch,
						commit: call.commit,
					}),
				);
				return;
			case "session":
				for await (const item of device.session({ ...call.input, signal })) {
					yield { kind: "item", item };
				}
				return;
			case "exec":
				for await (const item of device.exec({ ...call.input, signal })) {
					yield { kind: "item", item };
				}
				return;
			case "callTool":
				yield result(await device.callTool({ ...call.input, signal }));
				return;
			case "decide":
				yield result(
					"output" in call.input
						? await device.decide({ ...call.input, signal })
						: await device.decide({ ...call.input, signal }),
				);
				return;
		}
	} catch (error) {
		yield {
			kind: "error",
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

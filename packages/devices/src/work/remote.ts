import type {
	DecisionInput,
	DecisionResult,
	ValueInput,
	ValueResult,
} from "@nightshift/agents/types";
import {
	type Capabilities,
	type Device,
	type ExecEvent,
	type ExecInput,
	noRunFolders,
	type OfferedSessionInput,
	type ReadFileResult,
	type RunFolder,
	type SessionEvent,
	type SessionInput,
	type ToolResult,
	type WebRequestResult,
	type Worktree,
	type WorktreeChanges,
} from "@nightshift/engine";
import type { FlowSources } from "@nightshift/flows";
import { Refusal, wordsFor } from "@nightshift/refusal";
import {
	UNREADABLE_REQUEST,
	type WorkCall,
	type WorkFor,
	type WorkRelay,
	type WorkReply,
	type WorkRequest,
} from "../contract";
import { pause } from "../links";

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

/** A placed Device that went quiet in the middle of a call. */
function stopped(name: string): string {
	return `${name} stopped answering before the step ended.`;
}

/**
 * The error of a reply, as a refusal: the serving Device sent words for
 * people (its refusal, or its plain words for a failure it logged).
 */
function refusalOf(reply: { message: string; offline?: boolean }): Refusal {
	return new Refusal(reply.offline ? "unavailable" : "conflict", reply.message);
}

/** The words a step shows for a call that failed: a refusal's own, else plain words, and the details go to the log. */
function failureWords(error: unknown, call: string): string {
	if (!(error instanceof Refusal))
		console.error(`[work] ${call} failed:`, error);
	return wordsFor(error);
}

/** A placed Device that did not answer a call within its deadline. */
function noAnswer(name: string): string {
	return `${name} did not answer in time. Check that it is online, then try again.`;
}

/**
 * How long a call that answers once may take. A call lost on the way, or
 * a Device that hangs, then ends with a refusal and frees what waits for
 * it, such as a run's start. Calls a step runs (`decide`, `callTool`,
 * `request`) have
 * their own limits through the step's signal.
 */
export const CALL_DEADLINES_MS: Partial<Record<WorkCall["kind"], number>> = {
	capabilities: 60_000,
	flows: 60_000,
	itemBranch: 2 * 60_000,
	snapshotWorktree: 2 * 60_000,
	worktreeChanges: 2 * 60_000,
	runFolder: 60_000,
	// A report file is at most 64 KB.
	readFile: 30_000,
	// Git work on a large project can take minutes.
	worktree: 3 * 60_000,
	handOff: 3 * 60_000,
	receiveHandOff: 3 * 60_000,
};

/**
 * How long a session or a command waits after its last event for the
 * placed Device to end its call. The Device ends it after its cleanup:
 * the harness's files and the CLI tool launchers go, and what the step
 * changed in the knowledge reaches the Host (it waits up to 10 s for
 * that). A Device that went away, or hangs, holds the step no longer.
 */
export const CLEANUP_WAIT_MS = 30_000;

/** Another Device, reached through `relay`, working for one run (or its start). */
export function remoteDevice(
	relay: WorkRelay,
	device: { id: string; name: string },
	forRun: WorkFor,
	options: {
		/** Waits out `CLEANUP_WAIT_MS`, or less when `signal` aborts. Default a timer. */
		pause?: (ms: number, signal: AbortSignal) => Promise<void>;
	} = {},
): Device {
	const wait = options.pause ?? pause;
	const ask = (call: WorkCall, signal?: AbortSignal, projectId?: string) =>
		relay.call(
			device.id,
			{ ...forRun, ...(projectId ? { projectId } : {}), call },
			signal,
		);

	/**
	 * The replies of a streaming call (`session`, `exec`). A placed Device
	 * ends a call only after its cleanup there, as every version does
	 * (`createWorkServer`): the end of the call is its "cleaned up". So
	 * once the call's last event came, `close` reads on until the call
	 * ends, and the step ends after the cleanup, as it does on this
	 * computer. It waits `CLEANUP_WAIT_MS` at most, then cancels the call
	 * there. A stop ends the wait at once. A call closed before its last
	 * event is cancelled there.
	 */
	function streamed(call: WorkCall, signal: AbortSignal) {
		const giveUp = new AbortController();
		const replies = ask(call, AbortSignal.any([signal, giveUp.signal]))[
			Symbol.asyncIterator
		]();
		let last = false;
		return {
			next: () => replies.next(),
			/** The call's last event came: `close` waits for the Device to end the call. */
			lastCame() {
				last = true;
			},
			async close() {
				if (!last) {
					await replies.return?.();
					return;
				}
				const over = new AbortController();
				const late = wait(CLEANUP_WAIT_MS, over.signal).then(
					() => "late" as const,
				);
				try {
					while (true) {
						const next = await Promise.race([replies.next(), late]);
						if (next === "late") {
							giveUp.abort();
							return;
						}
						if (next.done) return;
					}
				} catch {
					// The Device went away during its cleanup: the step goes on.
				} finally {
					over.abort();
				}
			},
		};
	}

	/** The one result of a call; throws its error as a refusal (`refusalOf`). */
	async function once<T>(
		call: WorkCall,
		signal?: AbortSignal,
		projectId?: string,
	): Promise<T> {
		const limit = CALL_DEADLINES_MS[call.kind];
		const deadline =
			limit === undefined ? undefined : AbortSignal.timeout(limit);
		const ended =
			signal && deadline
				? AbortSignal.any([signal, deadline])
				: (signal ?? deadline);
		for await (const reply of ask(call, ended, projectId)) {
			if (reply.kind === "result") return reply.value as T;
			if (reply.kind === "error") throw refusalOf(reply);
		}
		if (deadline?.aborted && !signal?.aborted) {
			throw new Refusal("unavailable", noAnswer(device.name));
		}
		throw new Refusal("unavailable", stopped(device.name));
	}

	async function* session(
		input: SessionInput | OfferedSessionInput,
	): AsyncGenerator<SessionEvent> {
		const { signal, ...rest } = input;
		let started = false;
		let ended = false;
		const replies = streamed({ kind: "session", input: rest }, signal);
		try {
			while (true) {
				const next = await replies.next();
				if (next.done) break;
				const reply = next.value;
				if (reply.kind === "error") {
					replies.lastCame();
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
				if (event.type === "finished" || event.type === "error") {
					ended = true;
					replies.lastCame();
				}
				yield event;
			}
		} finally {
			await replies.close();
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
		const replies = streamed({ kind: "exec", input: rest }, signal);
		try {
			while (true) {
				const next = await replies.next();
				if (next.done) break;
				const reply = next.value;
				if (reply.kind === "error") {
					replies.lastCame();
					yield { type: "exit", exitCode: null, spawnError: reply.message };
					return;
				}
				if (reply.kind !== "item") continue;
				const event = reply.item as ExecEvent;
				if (event.type === "exit") replies.lastCame();
				yield event;
				if (event.type === "exit") return;
			}
		} finally {
			await replies.close();
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
				message: failureWords(error, `a decide call on ${device.name}`),
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
		flows: (projectId) =>
			once<FlowSources>({ kind: "flows" }, undefined, projectId),
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
					message: failureWords(error, `a tool call on ${device.name}`),
					arguments: null,
				};
			}
		},
		/**
		 * A web request on that Device. A Device of an older Night Shift
		 * cannot read the call: run start refuses it first (its
		 * capabilities say no `requests`), and the call says to update it.
		 * One that went away is a network failure: the step waits for it.
		 */
		async request(input): Promise<WebRequestResult> {
			const { signal, ...rest } = input;
			try {
				return await once<WebRequestResult>(
					{ kind: "request", input: rest },
					signal,
				);
			} catch (error) {
				if (error instanceof Refusal && error.message === UNREADABLE_REQUEST) {
					return {
						kind: "refused",
						message: `${device.name} runs an older version of Night Shift. Update Night Shift on ${device.name}.`,
					};
				}
				return {
					kind: "failed",
					message: failureWords(error, `a web request on ${device.name}`),
					network: true,
				};
			}
		},
		/**
		 * A file the run wrote in its folder on that Device. A Device of an
		 * older Night Shift cannot read the call: run start refuses it
		 * first (its capabilities say no `readFiles`), and the call says to
		 * update it. One that went away throws an `unavailable` refusal.
		 */
		async readFile(input): Promise<ReadFileResult> {
			const { signal, ...rest } = input;
			try {
				return await once<ReadFileResult>(
					{ kind: "readFile", input: rest },
					signal,
				);
			} catch (error) {
				if (error instanceof Refusal && error.message === UNREADABLE_REQUEST) {
					throw new Refusal(
						"conflict",
						`${device.name} runs an older version of Night Shift. Update Night Shift on ${device.name}.`,
					);
				}
				throw error;
			}
		},
		decide,
		worktree: (run) => once<Worktree>({ kind: "worktree", run }),
		// A Device of an older Night Shift cannot read the call: it says to update it.
		async runFolder(run) {
			try {
				return await once<RunFolder>({ kind: "runFolder", run });
			} catch (error) {
				if (error instanceof Refusal && error.message === UNREADABLE_REQUEST) {
					throw new Refusal("conflict", noRunFolders(device.name));
				}
				throw error;
			}
		},
		handOff: (input) =>
			once<{ commit: string; branch: string }>({ kind: "handOff", ...input }),
		receiveHandOff: (input) =>
			once<Worktree>({ kind: "receiveHandOff", ...input }),
		itemBranch: (input) =>
			once<{ branch: string; base: string }>({ kind: "itemBranch", ...input }),
		// A Device of an older Night Shift cannot read these calls: an error, which the step runner skips.
		snapshotWorktree: ({ cwd, signal }) =>
			once<{ tree: string }>({ kind: "snapshotWorktree", cwd }, signal),
		worktreeChanges: ({ cwd, from, signal }) =>
			once<WorktreeChanges>({ kind: "worktreeChanges", cwd, from }, signal),
	};
}

/** A call's input without the run it names: `serveWork` sets the request's. */
function withoutRun<T extends { run?: unknown }>(input: T): T {
	const { run: _, ...rest } = input;
	// Each member of a union of inputs, less one optional field.
	return rest as T;
}

/** The words of a secret call that came as a call of a run. */
const NOT_A_RUN_CALL = "This device moves its secrets only for its owner.";

/** The words of a snapshot call on a Device that takes none. */
const NO_SNAPSHOTS = "This device does not tell what a step changed.";

/** The words of a file call on a Device that reads none. */
const NO_FILES = "This device does not read the files of a run.";

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
	// The run a step's call works for is the request's own, never one the
	// call's input names: the Project secrets it reads are that run's
	// (ADR 13), and the Host checked that run for this Device.
	const run =
		request.runId === null
			? {}
			: {
					run: {
						spaceId: request.spaceId,
						projectId: request.projectId,
						runId: request.runId,
					},
				};
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
			case "runFolder":
				if (!device.runFolder) {
					throw new Refusal("conflict", noRunFolders(device.name));
				}
				yield result(await device.runFolder(call.run));
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
			case "snapshotWorktree":
				if (!device.snapshotWorktree)
					throw new Refusal("conflict", NO_SNAPSHOTS);
				yield result(await device.snapshotWorktree({ cwd: call.cwd, signal }));
				return;
			case "worktreeChanges":
				if (!device.worktreeChanges)
					throw new Refusal("conflict", NO_SNAPSHOTS);
				yield result(
					await device.worktreeChanges({
						cwd: call.cwd,
						from: call.from,
						signal,
					}),
				);
				return;
			case "session":
				for await (const item of device.session({
					...withoutRun(call.input),
					...run,
					signal,
				})) {
					yield { kind: "item", item };
				}
				return;
			case "exec":
				for await (const item of device.exec({
					...withoutRun(call.input),
					...run,
					signal,
				})) {
					yield { kind: "item", item };
				}
				return;
			case "callTool":
				yield result(
					await device.callTool({
						...withoutRun(call.input),
						...run,
						signal,
					}),
				);
				return;
			case "request":
				yield result(
					await device.request({
						...withoutRun(call.input),
						...run,
						signal,
					}),
				);
				return;
			case "readFile":
				if (!device.readFile) throw new Refusal("conflict", NO_FILES);
				yield result(await device.readFile({ ...call.input, signal }));
				return;
			case "decide":
				yield result(
					"output" in call.input
						? await device.decide({
								...withoutRun(call.input),
								...run,
								signal,
							})
						: await device.decide({
								...withoutRun(call.input),
								...run,
								signal,
							}),
				);
				return;
			case "secret":
				// Never a call of a run: the Device serves it apart, from its
				// Home Host only (`serveSecretCall`).
				throw new Refusal("forbidden", NOT_A_RUN_CALL);
		}
	} catch (error) {
		if (!(error instanceof Refusal)) {
			console.error(
				`[work] a ${call.kind} call for ${request.spaceId} failed:`,
				error,
			);
		}
		yield { kind: "error", message: wordsFor(error) };
	}
}

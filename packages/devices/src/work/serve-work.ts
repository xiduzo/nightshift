import { type Device, noRunFolders } from "@nightshift/engine";
import { Refusal, wordsFor } from "@nightshift/refusal";
import { codeOfRefusal, type WorkReply, type WorkRequest } from "../contract";

/**
 * The placed Device's side of a call: `serveWork` answers one `WorkRequest`
 * with this computer's own Device. `remoteDevice` (`remote.ts`) is the
 * Walker's side.
 */

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
			case "worktree":
				yield result(await device.worktree(call.run));
				return;
			case "restoreWorktree":
				yield result(
					await device.restoreWorktree({ run: call.run, cwd: call.cwd }),
				);
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
		const code = codeOfRefusal(error);
		yield {
			kind: "error",
			message: wordsFor(error),
			...(code ? { code } : {}),
		};
	}
}

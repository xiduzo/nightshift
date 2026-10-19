import type { AppRouterClient } from "@nightshift/api/routers/index";
import { roleAllows } from "@nightshift/auth/access";
import type { Database } from "@nightshift/db";
import {
	clonePathOf,
	type Device,
	personOnHost,
	serveWork,
	type WorkCall,
	type WorkReply,
	type WorkRequest,
	workRequestSchema,
	worktreeLocation,
} from "@nightshift/engine";
import type { Engine } from "@nightshift/engine/types";

/**
 * This computer as a placed Device: the work of runs its Host walks with
 * their steps here. It takes its calls over its own Link (`devices.work`,
 * outbound only), checks each one from its own Replica before it starts
 * anything (`checkWork`), serves it with its own `localDevice`
 * (`serveWork`), and sends the replies back (`devices.workReply`), a batch
 * at a time. A cancel from the Host aborts the call here: its session or
 * command ends.
 *
 * A call outlives its stream: the replies of a session that runs while
 * the link drops go when it is back. A call whose replies cannot reach the
 * Host for `replyDeadlineMs` is aborted: nothing runs here for a Walker
 * that is gone.
 */

export type WorkServer = {
	/** Takes and serves the Host's calls while its link is online. */
	whileOnline(client: AppRouterClient, signal: AbortSignal): Promise<void>;
	/** The calls running here now. */
	running(): number;
};

export function createWorkServer(deps: {
	hostId: string;
	db: Database;
	engine: Engine;
	/** This computer as a Device. */
	device: Device;
	retryMs?: number;
	replyDeadlineMs?: number;
}): WorkServer {
	const retryMs = deps.retryMs ?? 2_000;
	const replyDeadlineMs = deps.replyDeadlineMs ?? 60_000;
	const calls = new Map<string, AbortController>();
	let client: AppRouterClient | null = null;

	/** The replies of one call, sent in order, a batch at a time. */
	function outbox(id: string, abort: () => void) {
		const pending: WorkReply[] = [];
		let ended = false;
		let closed = false;
		let busy = false;
		let failingSince: number | null = null;
		async function pump() {
			if (busy || closed) return;
			busy = true;
			try {
				while (pending.length > 0 || ended) {
					const replies = pending.splice(0, 500);
					const done = ended && pending.length === 0;
					try {
						if (!client) throw new Error("No link to the Host.");
						await client.devices.workReply({ id, replies, done });
						failingSince = null;
						if (done) {
							closed = true;
							return;
						}
					} catch {
						pending.unshift(...replies);
						failingSince ??= Date.now();
						if (Date.now() - failingSince > replyDeadlineMs) {
							closed = true;
							abort();
							return;
						}
						await Bun.sleep(1_000);
					}
				}
			} finally {
				busy = false;
			}
		}
		return {
			push(reply: WorkReply) {
				pending.push(reply);
				void pump();
			},
			end() {
				ended = true;
				void pump();
			},
		};
	}

	async function serve(id: string, raw: unknown): Promise<void> {
		const controller = new AbortController();
		calls.set(id, controller);
		const out = outbox(id, () => controller.abort());
		try {
			const parsed = workRequestSchema.safeParse(raw);
			const request = parsed.success
				? (parsed.data as unknown as WorkRequest)
				: null;
			const refusal = request
				? await checkWork(request, deps)
				: "This device cannot read that request. Update Night Shift on both computers.";
			if (refusal !== null || !request) {
				out.push({ kind: "error", message: refusal ?? "" });
				return;
			}
			for await (const reply of serveWork(
				deps.device,
				request,
				controller.signal,
			)) {
				out.push(reply);
			}
		} catch (error) {
			out.push({
				kind: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		} finally {
			calls.delete(id);
			out.end();
		}
	}

	return {
		running: () => calls.size,
		async whileOnline(next, signal) {
			client = next;
			while (!signal.aborted) {
				try {
					const stream = await next.devices.work(undefined, { signal });
					for await (const delivery of stream) {
						if (delivery.kind === "cancel") {
							calls.get(delivery.id)?.abort();
						} else if (!calls.has(delivery.id)) {
							void serve(delivery.id, delivery.request);
						}
					}
				} catch (error) {
					if (signal.aborted) return;
					console.error("Work from the Host was not received:", error);
				}
				await pause(retryMs, signal);
			}
		},
	};
}

/** The folder a call works in, for the calls that name one. */
function cwdOf(call: WorkCall): string | null {
	switch (call.kind) {
		case "session":
		case "exec":
			return call.input.cwd;
		case "files":
		case "itemBranch":
			return call.cwd;
		default:
			return null;
	}
}

/**
 * Why this computer does not serve a call, or null: the placed Device's
 * own checks, from its own Replica, before it starts anything.
 *
 * - The Space is one it takes part in through this Host.
 * - The run is its owner's: the Person who starts it is the Person of this
 *   computer's link (another Person's run needs an Offer, which is not
 *   built yet), with a role in the Space that starts runs (the Space
 *   document's Member mirror).
 * - It has a Clone of the project, in that Space.
 * - A call that works in a folder works in the run's own worktree.
 */
export async function checkWork(
	request: WorkRequest,
	deps: { hostId: string; db: Database; engine: Engine },
): Promise<string | null> {
	const { db, engine } = deps;
	const { spaceId, projectId, personId, runId, call } = request;
	if ((await engine.exchange.hostSpaces.hostOf(spaceId)) !== deps.hostId) {
		return "This device does not take part in that Space through this Host.";
	}
	if ((await personOnHost(db, spaceId)) !== personId) {
		return "This device runs steps for its owner's runs only.";
	}
	const role = await engine.exchange.memberRole(spaceId, personId);
	if (!role || !roleAllows(role, { run: ["start"] })) {
		return "Your role in this Space does not allow starting runs.";
	}
	const repoPath = await clonePathOf(db)(projectId, spaceId);
	if (repoPath === null) {
		return "This device does not have this project. Add its folder there first.";
	}
	if (
		call.kind === "worktree" &&
		(call.run.id !== runId || call.run.projectId !== projectId)
	) {
		return "This device adds a folder only for the run that asks.";
	}
	const cwd = cwdOf(call);
	if (cwd !== null) {
		const own =
			runId === null
				? null
				: worktreeLocation(repoPath, runId.slice(0, 8)).worktreePath;
		if (own === null || (cwd !== own && !cwd.startsWith(`${own}/`))) {
			return "This device works only in the run's own folder.";
		}
	}
	return null;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve();
		const done = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		};
		const timer = setTimeout(done, ms);
		signal.addEventListener("abort", done, { once: true });
	});
}

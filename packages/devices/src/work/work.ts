import { now as timeNow } from "@nightshift/time";
import {
	type WorkReply,
	type WorkRequest,
	workRequestSchema,
} from "../contract";
import { backoff, type Link, pause } from "../links";

/**
 * This computer as a placed Device: the work of runs its Host walks with
 * their steps here. It takes its calls over its own Link (`devices.work`,
 * outbound only, a stream of the Link), reads each one, hands it to its
 * Offer admission (`OfferAdmission.serve`: every check, from its own
 * Replica, before it starts anything), and sends the replies back
 * (`devices.workReply`), a batch at a time. A cancel from the Host aborts
 * the call here: its session or command ends.
 *
 * A call outlives its stream: the replies of a session that runs while
 * the link drops go when it is back, after a backoff when the Host does
 * not take them. A call whose replies cannot reach the Host for
 * `replyDeadlineMs` is aborted: nothing runs here for a Walker that is
 * gone. The daemon reads it from the Device setting `offlineWorkMinutes`
 * each time a call's replies fail.
 *
 * A call outlives its server too. The calls and the link they reply over
 * are `ServedCalls`, which a `bun --hot` reload gives to the next server:
 * a session runs on through the reload, once, and its replies go over the
 * new link.
 */

/**
 * How long a call keeps running here while its replies cannot reach the
 * Host, when no setting says: the session goes on and its events wait,
 * and the Walker gets them when the link is back. After that the call
 * stops: nothing runs for a Walker that is gone.
 */
export const REPLY_DEADLINE_MS = 10 * 60_000;

export type WorkServer = {
	/** Takes and serves the Host's calls over its link while it is online. Returns how to stop. */
	attach(link: Pick<Link, "stream" | "ready">): () => void;
	/** The calls running here now. */
	running(): number;
};

/**
 * The calls this computer serves for one Host, and the link their replies
 * go over. They outlive the work server that took them: the next one
 * takes them over (`createWorkServer({ served })`) and names them to the
 * Host, so the Host keeps waiting for them.
 */
export type ServedCalls = {
	/** The calls running here, by id. Aborting one ends it. */
	readonly running: Map<string, AbortController>;
	/** The link the replies go over: the one attached last. Null while none is. */
	link: Pick<Link, "ready"> | null;
};

export function servedCalls(): ServedCalls {
	return { running: new Map(), link: null };
}

export function createWorkServer(deps: {
	/**
	 * Serves one call of this Host after this computer's own checks
	 * (`OfferAdmission.serve`). Never throws: a refusal is an `error` reply.
	 */
	serve(request: WorkRequest, signal: AbortSignal): AsyncIterable<WorkReply>;
	/** The calls of the server before this one, which this one takes over. Default: none. */
	served?: ServedCalls;
	/** Read each time a call's replies fail: the Device setting. Default `REPLY_DEADLINE_MS`. */
	replyDeadlineMs?: () => number;
	/** The clock. Default `now`. */
	now?: () => number;
	/** Waits between two tries to send the replies. Default a timer. */
	pause?: (ms: number) => Promise<void>;
}): WorkServer {
	const replyDeadlineMs = deps.replyDeadlineMs ?? (() => REPLY_DEADLINE_MS);
	const now = deps.now ?? timeNow;
	const wait = deps.pause ?? pause;
	/** The calls, and the link they reply over. A call outlives a link that restarts, and this server. */
	const served = deps.served ?? servedCalls();
	const calls = served.running;

	/** The replies of one call, sent in order, a batch at a time. */
	function outbox(id: string, abort: () => void) {
		const pending: WorkReply[] = [];
		let ended = false;
		let closed = false;
		let busy = false;
		let failingSince: number | null = null;
		/** The waits of a batch the Host did not take. */
		const waits = backoff({ firstMs: 1_000, maxMs: 30_000 });
		async function pump() {
			if (busy || closed) return;
			busy = true;
			try {
				while (pending.length > 0 || ended) {
					const replies = pending.splice(0, 500);
					const done = ended && pending.length === 0;
					const since = failingSince ?? now();
					try {
						const link = served.link;
						if (!link) throw new Error("No link to the Host.");
						// Offline: wait for the link, but not past the deadline.
						const client = await link.ready(
							AbortSignal.timeout(
								Math.max(0, since + replyDeadlineMs() - now()),
							),
						);
						const { known } = await client.devices.workReply({
							id,
							replies,
							done,
						});
						failingSince = null;
						waits.reset();
						// The Host no longer waits for it (it restarted, or the
						// Walker gave up): the call stops here.
						if (!known) {
							closed = true;
							abort();
							return;
						}
						if (done) {
							closed = true;
							return;
						}
					} catch {
						pending.unshift(...replies);
						failingSince = since;
						if (now() - failingSince >= replyDeadlineMs()) {
							closed = true;
							abort();
							return;
						}
						await wait(waits.next());
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
			if (!parsed.success) {
				out.push({
					kind: "error",
					message:
						"This device cannot read that request. Update Night Shift on both computers.",
				});
				return;
			}
			for await (const reply of deps.serve(
				parsed.data as unknown as WorkRequest,
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
		attach(next) {
			served.link = next;
			const stop = next.stream("devices.work", async (client, signal) => {
				const stream = await client.devices.work(
					{ running: [...calls.keys()] },
					{ signal },
				);
				for await (const delivery of stream) {
					if (delivery.kind === "cancel") {
						calls.get(delivery.id)?.abort();
					} else if (!calls.has(delivery.id)) {
						void serve(delivery.id, delivery.request);
					}
				}
			});
			return () => {
				stop();
				if (served.link === next) served.link = null;
			};
		},
	};
}

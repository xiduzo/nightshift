import type { DeviceCopies } from "@nightshift/engine";
import { FAILURE_MESSAGE, Refusal } from "@nightshift/refusal";
import { ORPCError } from "@orpc/client";
import type {
	LeaveResult,
	MergePending,
	MergePreview,
	MergeResult,
	SplitResult,
} from "../contract";
import type {
	DeviceKeyStore,
	DeviceLinks,
	HostLinks,
	HostRole,
	JoinProgress,
	Link,
} from "../links";
import { MERGE_WORDS, type MergeDeps, mergeSteps } from "./merge";
import { membershipRecord } from "./record";
import { type SplitDeps, splitSteps } from "./split";

export const LEAVE_WORDS = {
	noHome: "This computer has no home Host.",
} as const;

/** How long a new join waits for its home Host to list the personal Space. */
const LISTED_WAIT_MS = 30_000;

export type HomeMembershipDeps = MergeDeps &
	SplitDeps & {
		links: Pick<DeviceLinks, "get" | "add">;
		hostLinks: Pick<HostLinks, "home" | "get" | "revoked">;
		keys: Pick<DeviceKeyStore, "delete">;
		/** The copies of the Person's other Devices, which only the home Host gives. */
		copies: Pick<DeviceCopies, "keep">;
		/** How long the merge on join waits for the Host's list. Default 30 s. */
		listedWaitMs?: number;
	};

/**
 * This computer's membership of its home Host (ADR 1), as one state
 * machine: apart, merging, joined, splitting, apart again.
 *
 * - Apart → merging: this computer joined its home Host (`joined`), or
 *   its person merges a Personal that waits (`merge`).
 * - Merging → joined: the merge moved the rows and the Host has the runs
 *   (`merge.ts`).
 * - Joined → splitting: this computer leaves (`leave`), or the Host
 *   removed its access (`revoked`).
 * - Splitting → apart: Personal is this computer's own again (`split.ts`).
 *   A merge that never moved a row ends with it.
 *
 * One step at a time in this process: a person's merge is refused while
 * one runs, and a leave, a revoke or the timer waits for it. Each step
 * keeps its state in one record (`membershipRecord`), so a crash leaves
 * none half done, and `keepFinishing` goes on from it. A merge goes on
 * by itself only once it moved its rows: before that, the person asks.
 */
export type HomeMembership = ReturnType<typeof createHomeMembership>;

export function createHomeMembership(deps: HomeMembershipDeps) {
	const record = membershipRecord(deps.db);

	const merges = mergeSteps({ ...deps, record });
	const splits = splitSteps({ ...deps, record });

	/** The steps queued or under way. */
	let queued = 0;
	let last: Promise<unknown> = Promise.resolve();

	/**
	 * Runs `work` once the steps before it are done. `refuse`: refuses
	 * instead while a step is queued or under way.
	 */
	function exclusive<T>(
		work: () => Promise<T>,
		whenBusy: "refuse" | "wait",
	): Promise<T> {
		if (queued > 0 && whenBusy === "refuse") {
			return Promise.reject(new Refusal("conflict", MERGE_WORDS.busy));
		}
		queued++;
		const task = last
			.catch(() => {})
			.then(work)
			.finally(() => {
				queued--;
			});
		last = task;
		return task;
	}

	/**
	 * Splits Personal off once this computer left its Host, or goes on
	 * with a split that stopped. Without a split, a merge that never moved
	 * a row ends when its Host is gone: it cannot go on without it.
	 */
	async function settle(): Promise<SplitResult | null> {
		const started = await record.unfinished();
		const split = await splits.splitOff(
			started?.step === "split" ? started.row : null,
		);
		if (split) return split;
		if (started?.step === "merge") {
			const link = await deps.hostLinks.get(started.row.hostId);
			if (!link || link.revokedAt !== null) {
				await deps.db.batch([record.merges.abandon()]);
			}
		}
		return null;
	}

	/**
	 * Merges Personal into the home Host's, or goes on with a merge that
	 * stopped. `join`: the Projects to move into the Project of a shared
	 * Space with their remote. Resolves with how far it came: `moved` when
	 * the Host does not have the runs yet (they follow).
	 */
	function merge(
		input: { join?: readonly string[] } = {},
	): Promise<MergeResult> {
		return exclusive(async () => {
			const started = await record.unfinished();
			if (started?.step === "merge") return merges.resume(started.row);
			return merges.start(input);
		}, "refuse");
	}

	return {
		/**
		 * Whether this computer's Personal waits to merge, for a Device that
		 * joined its home Host before the merge existed, or a merge that
		 * stopped. Never merges by itself: the person confirms it. `blocked`:
		 * why it cannot run now. Cheap: no call to the Host.
		 */
		async pending(): Promise<MergePending> {
			const started = await record.unfinished();
			return merges.pending(started?.step === "merge" ? started.row : null);
		},

		/** What a merge would do now. Refuses when it cannot run now. Changes nothing. */
		preview(input: { join?: readonly string[] } = {}): Promise<MergePreview> {
			return merges.preview(input);
		},

		merge,

		/**
		 * Merge on join: this computer paired with `hostId` as its home
		 * Host, and its Personal merges into the Host's. It waits for the new
		 * link to answer and list the personal Space, shows the preview,
		 * then merges. A merge that cannot run now ends the join with the
		 * reason: the join itself stands, and the merge waits for the person
		 * (`merge-skipped`). Nothing to merge: nothing more.
		 */
		async *joined(
			hostId: string,
			signal?: AbortSignal,
		): AsyncGenerator<JoinProgress> {
			const end = Date.now() + (deps.listedWaitMs ?? LISTED_WAIT_MS);
			while (Date.now() < end && !signal?.aborted) {
				const link = deps.links.get(hostId);
				const listed = await deps.engine.hostSpaces.listed(hostId);
				if (
					link?.state().status === "online" &&
					listed.some((space) => space.personal)
				) {
					break;
				}
				await Bun.sleep(200);
			}
			const checked = await merges.checks();
			if (checked.held === "merged") return;
			if (checked.held !== null) {
				yield { kind: "merge-skipped", reason: checked.refusal.message };
				return;
			}
			try {
				const preview = await merges.preview();
				yield { kind: "merge-preview", preview };
				const result = await merge();
				yield { kind: "merged", result };
			} catch (error) {
				if (!(error instanceof Refusal)) {
					console.error("[devices] the merge on join failed:", error);
				}
				yield {
					kind: "merge-skipped",
					reason: error instanceof Refusal ? error.message : FAILURE_MESSAGE,
				};
			}
		},

		/**
		 * This computer leaves its home Host (`nightshift leave`): the Host
		 * removes its access, and Personal splits off the Host's with what
		 * this computer worked on. The Host keeps everything.
		 *
		 * Refuses before it changes anything without a home Host, and while
		 * a run this computer walks in Personal is not done. A Host that does
		 * not answer does not hold it back: this computer leaves on its own,
		 * and the Host lists it until its owner removes it there (`told`).
		 * The link stops and its key goes, then the copies of the Person's
		 * other Devices, then the split. A split that waits for runs says so
		 * (`waiting`): it goes on by itself once they are done.
		 */
		leave(): Promise<LeaveResult> {
			return exclusive(async () => {
				const link = await deps.hostLinks.home();
				if (!link) throw new Refusal("conflict", LEAVE_WORDS.noHome);
				const from = await splits.check();

				const told = await tell(deps.links.get(link.hostId));
				await deps.hostLinks.revoked(link.hostId);
				await deps.keys.delete(link.hostId);
				// A link without access does not start again: this stops it.
				const left = await deps.hostLinks.get(link.hostId);
				if (left) await deps.links.add(left);
				await deps.copies.keep([]);

				let waiting: string | null = null;
				try {
					await settle();
				} catch (error) {
					if (!(error instanceof Refusal)) throw error;
					waiting = error.message;
				}
				return {
					host: { id: link.hostId, name: link.name },
					told,
					split: from === null ? null : await splits.of(from),
					waiting,
				};
			}, "wait");
		},

		/**
		 * A Host removed this computer's access. Its home Host: this
		 * computer learns nothing more of its other Devices, and Personal
		 * splits off the Host's (it keeps a copy). Resolves with the split,
		 * null when nothing split off. Refuses while a run this computer
		 * walks there is not done: `keepFinishing` tries again.
		 */
		async revoked(link: { role: HostRole }): Promise<SplitResult | null> {
			if (link.role !== "home") return null;
			await deps.copies.keep([]);
			return exclusive(settle, "wait");
		},

		/**
		 * Goes on with what stopped, now and every `everyMs`, until `signal`
		 * aborts: a split once this computer left its Host (it waits for
		 * the runs this computer walks), and a merge that moved its rows
		 * (its runs reach the Host when it answers). Its failures wait for
		 * the next try. Once at start, it removes what a merge that is done
		 * left of the old Space: a merge of an older version did not.
		 */
		keepFinishing(signal: AbortSignal, everyMs = 30_000): void {
			let first = true;
			const attempt = () => {
				if (queued > 0 || signal.aborted) return;
				const cleanUp = first;
				first = false;
				exclusive(async () => {
					if (cleanUp) await merges.cleanUpDone();
					await settle();
					const started = await record.unfinished();
					if (started?.step === "merge" && started.row.state === "moved") {
						await merges.resume(started.row);
					}
				}, "wait").catch((error) => {
					if (!(error instanceof Refusal)) {
						console.error("[devices] Personal did not finish its move:", error);
					}
				});
			};
			const now = setTimeout(attempt, 0);
			const timer = setInterval(attempt, everyMs);
			now.unref?.();
			timer.unref?.();
			signal.addEventListener(
				"abort",
				() => {
					clearTimeout(now);
					clearInterval(timer);
				},
				{ once: true },
			);
		},
	};
}

/** Asks the Host to remove this computer's access. False: it did not. */
async function tell(link: Link | undefined): Promise<boolean> {
	if (!link) return false;
	try {
		await link.call((client) => client.link.leave());
		return true;
	} catch (error) {
		// A Host that no longer knows this computer let it go already.
		return error instanceof ORPCError && error.code === "UNAUTHORIZED";
	}
}

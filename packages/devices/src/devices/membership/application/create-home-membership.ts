import { FAILURE_MESSAGE, Refusal } from "@nightshift/refusal";
import { now as timeNow } from "@nightshift/time";
import type {
	LeaveResult,
	MergePending,
	MergePreview,
	MergeResult,
	SplitResult,
} from "../../../contract";
import type {
	DeviceKeyStore,
	DeviceLinks,
	HostLinks,
	HostRole,
	JoinProgress,
	Link,
} from "../../../links";
import { LEAVE_WORDS, MERGE_WORDS, mergeHeld } from "../domain/words";
import { type MergeDeps, mergeSteps } from "./merge-steps";
import type { Batches, DeviceCopiesPort, MembershipRecord } from "./ports";
import { type SplitDeps, splitSteps } from "./split-steps";

/** How long a new join waits for its home Host to list the personal Space. */
const LISTED_WAIT_MS = 30_000;

export type HomeMembershipDeps = MergeDeps &
	SplitDeps & {
		record: MembershipRecord;
		batches: Batches;
		links: Pick<DeviceLinks, "get" | "add">;
		hostLinks: Pick<HostLinks, "home" | "get" | "list" | "revoked">;
		keys: Pick<DeviceKeyStore, "delete">;
		/** The copies of the Person's other Devices, which only the home Host gives. */
		copies: DeviceCopiesPort;
		/** Whether a leave call failed because the Host no longer knows this computer. */
		isNotPaired(error: unknown): boolean;
		/** How long the merge on join waits for the Host's list. Default 30 s. */
		listedWaitMs?: number;
	};

/**
 * This computer's membership of its home Host (ADR 1), as one state
 * machine: apart, merging, joined, splitting, apart again.
 */
export type HomeMembership = ReturnType<typeof createHomeMembership>;

export function createHomeMembership(deps: HomeMembershipDeps) {
	const record = deps.record;

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
	 * Forgets a split that moved no row when its Host gave access back to the
	 * same Person: there is nothing to leave. One that moved its rows ends.
	 */
	async function forgetSplit(): Promise<void> {
		const started = await record.unfinished();
		if (started?.step !== "split" || started.row.state !== "planned") return;
		const link = await deps.hostLinks.get(started.row.hostId);
		if (link?.revokedAt !== null) return;
		if (link.personId !== started.row.hostPersonId) return;
		await splits.forget(started.row);
	}

	/**
	 * Splits Personal off once this computer left its Host, or goes on
	 * with a split that stopped. Without a split, a merge that never moved
	 * a row ends when its Host is gone: it cannot go on without it.
	 */
	async function settle(): Promise<SplitResult | null> {
		await forgetSplit();
		const started = await record.unfinished();
		const split = await splits.splitOff(
			started?.step === "split" ? started.row : null,
		);
		if (split) return split;
		if (started?.step === "merge") {
			const link = await deps.hostLinks.get(started.row.hostId);
			if (!link || link.revokedAt !== null) {
				await deps.batches.run(record.merges.abandon());
			}
		}
		return null;
	}

	/**
	 * Deletes the key of a Host without access. False: it stays. A Host that
	 * gave access back has a new key, which stays too.
	 */
	async function dropKey(
		hostId: string,
		options?: { ownOnly: boolean },
	): Promise<boolean> {
		return attempted("the key of a Host stays", async () => {
			const link = await deps.hostLinks.get(hostId);
			if (link?.revokedAt === null) return;
			await deps.keys.delete(hostId, options);
		});
	}

	/** The copies of the Person's other Devices go: the home Host gave them. */
	function dropCopies(): Promise<boolean> {
		return attempted("the copies of other Devices stay", () =>
			deps.copies.keep([]),
		);
	}

	/**
	 * Merges Personal into the home Host's, or goes on with a merge that
	 * stopped. A leave of another Host ends first.
	 */
	function merge(
		input: { join?: readonly string[] } = {},
	): Promise<MergeResult> {
		return exclusive(async () => {
			await settle().catch((error) => {
				if (!(error instanceof Refusal)) throw error;
				// The words of a leave: this is a merge.
				throw mergeHeld("leaving").refusal;
			});
			const started = await record.unfinished();
			if (started?.step === "merge") return merges.resume(started.row);
			return merges.start(input);
		}, "refuse");
	}

	return {
		async pending(): Promise<MergePending> {
			const started = await record.unfinished();
			return merges.pending(started?.step === "merge" ? started.row : null);
		},

		preview(input: { join?: readonly string[] } = {}): Promise<MergePreview> {
			return merges.preview(input);
		},

		merge,

		async *joined(
			hostId: string,
			signal?: AbortSignal,
		): AsyncGenerator<JoinProgress> {
			await attempted("the leave of a Host goes on", () =>
				exclusive(settle, "wait"),
			);
			const end = timeNow() + (deps.listedWaitMs ?? LISTED_WAIT_MS);
			while (timeNow() < end && !signal?.aborted) {
				const link = deps.links.get(hostId);
				const listed = await deps.engine.hostSpaces.listed(hostId);
				if (
					link?.state().status === "online" &&
					listed.some((space) => space.personal)
				) {
					break;
				}
				await deps.wait.sleep(200);
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

		leave(): Promise<LeaveResult> {
			return exclusive(async () => {
				const link = await deps.hostLinks.home();
				if (!link) throw new Refusal("conflict", LEAVE_WORDS.noHome);
				const from = await splits.check();

				const told = await tell(deps.links.get(link.hostId), deps.isNotPaired);
				await deps.hostLinks.revoked(link.hostId);
				// From here on no step stops the next one. The link stops first: it
				// gives the copies. The key is last: its store may wait for a person.
				await attempted("the link of a Host goes on", async () => {
					const left = await deps.hostLinks.get(link.hostId);
					if (left) await deps.links.add(left);
				});
				await dropCopies();

				let waiting: string | null = null;
				let failed: { error: unknown } | null = null;
				try {
					await settle();
				} catch (error) {
					if (error instanceof Refusal) waiting = error.message;
					else failed = { error };
				}
				const keyKept = !(await dropKey(link.hostId));
				if (failed) throw failed.error;
				return {
					host: { id: link.hostId, name: link.name },
					told,
					split: from === null ? null : await splits.of(from),
					waiting,
					keyKept,
				};
			}, "wait");
		},

		/**
		 * A join saved the link of a Host, and it did not start yet: what an
		 * earlier leave left ends first. Else the pauses of a split that does
		 * not go on reach the Host with the flow documents.
		 */
		async beforeJoin(): Promise<void> {
			await attempted("the leave of a Host goes on", () =>
				exclusive(settle, "wait"),
			);
		},

		async revoked(link: { role: HostRole }): Promise<SplitResult | null> {
			if (link.role !== "home") return null;
			await dropCopies();
			return exclusive(settle, "wait");
		},

		/**
		 * Once at start, before the links and before a join.
		 *
		 * - What a leave that stopped left here goes: the copies and the key of a
		 *   Host without access. Not later: a join saves its new key first, then
		 *   its link.
		 * - A split that a join came before is forgotten.
		 * - The schedules of a merge whose rows moved are on again before their
		 *   documents sync.
		 */
		async beforeLinks(): Promise<void> {
			await attempted("a split is not forgotten yet", forgetSplit);
			await attempted("schedules of a merge stay paused", async () => {
				const started = await record.unfinished();
				if (started?.step === "merge" && started.row.state === "moved") {
					await merges.turnOnPaused(started.row);
				}
			});
			const left = (await deps.hostLinks.list()).filter(
				(link) => link.revokedAt !== null,
			);
			if (
				left.some((link) => link.role === "home") &&
				(await deps.hostLinks.home()) === null
			) {
				await dropCopies();
			}
			for (const link of left) await dropKey(link.hostId, { ownOnly: true });
		},

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
					if (!started) await merges.moveLate();
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

/** Runs a step whose failure does not stop the next one. False: it failed. */
async function attempted(
	failure: string,
	work: () => Promise<unknown>,
): Promise<boolean> {
	try {
		await work();
		return true;
	} catch (error) {
		console.error(`[devices] ${failure}:`, error);
		return false;
	}
}

/** Asks the Host to remove this computer's access. False: it did not. */
async function tell(
	link: Link | undefined,
	isNotPaired: (error: unknown) => boolean,
): Promise<boolean> {
	if (!link) return false;
	try {
		await link.call((client) => client.link.leave());
		return true;
	} catch (error) {
		return isNotPaired(error);
	}
}

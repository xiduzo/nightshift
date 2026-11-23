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
import { LEAVE_WORDS, MERGE_WORDS } from "../domain/words";
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
		hostLinks: Pick<HostLinks, "home" | "get" | "revoked">;
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
				await deps.batches.run(record.merges.abandon());
			}
		}
		return null;
	}

	/**
	 * Merges Personal into the home Host's, or goes on with a merge that
	 * stopped.
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
				await deps.keys.delete(link.hostId);
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

		async revoked(link: { role: HostRole }): Promise<SplitResult | null> {
			if (link.role !== "home") return null;
			await deps.copies.keep([]);
			return exclusive(settle, "wait");
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

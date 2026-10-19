import type { AppRouterClient } from "@nightshift/api/routers/index";
import { roleAllows } from "@nightshift/auth/access";
import type { Database } from "@nightshift/db";
import {
	clonePathOf,
	type Device,
	type DeviceOffer,
	inForce,
	type OfferSlots,
	offeredCallRefusal,
	offeredSession,
	type ProfileStore,
	personOnHost,
	serveWork,
	slotKey,
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
 *
 * Another Person's run uses this computer through its Offers only
 * (`checkWork`). Its sessions name an offered profile, which this computer
 * resolves itself (`offeredSession`: the permission mode no wider than
 * the cap), and wait for a free session of the Offer while it runs its
 * session cap (`OfferSlots`): a session over the cap queues here, it is
 * not refused. Withdrawing an Offer aborts the calls under it
 * (`withdrawn`); the Host stops their runs first.
 */

export type WorkServer = {
	/** Takes and serves the Host's calls while its link is online. */
	whileOnline(client: AppRouterClient, signal: AbortSignal): Promise<void>;
	/** The calls running here now. */
	running(): number;
	/** Aborts the calls running under an Offer that was withdrawn. */
	withdrawn(spaceId: string, profile: string): void;
};

/** What this computer offers, for the runs of other Persons. */
export type OfferDeps = {
	/** Its own Offers (its Device document). */
	offers(): readonly DeviceOffer[];
	/** A profile of this computer, as its owner set it. */
	profileFor: ProfileStore["settingsFor"];
	/** Shared by every Host: the sessions running under each Offer. */
	slots: OfferSlots;
};

export function createWorkServer(
	deps: {
		hostId: string;
		db: Database;
		engine: Engine;
		/** This computer as a Device. */
		device: Device;
		retryMs?: number;
		replyDeadlineMs?: number;
	} & OfferDeps,
): WorkServer {
	const retryMs = deps.retryMs ?? 2_000;
	const replyDeadlineMs = deps.replyDeadlineMs ?? 60_000;
	const calls = new Map<string, AbortController>();
	/** The Offer (its slot key) each offered session runs under. */
	const underOffer = new Map<string, string>();
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
			const admitted = request
				? await admitWork(request, deps)
				: {
						refusal:
							"This device cannot read that request. Update Night Shift on both computers.",
					};
			if ("refusal" in admitted || !request) {
				out.push({
					kind: "error",
					message: "refusal" in admitted ? admitted.refusal : "",
				});
				return;
			}
			let served = request;
			let release: (() => void) | null = null;
			const { call } = request;
			if (
				admitted.offers !== null &&
				call.kind === "session" &&
				"offered" in call.input
			) {
				// Another Person's session: this computer's own profile, its caps.
				const { profile } = call.input.offered;
				const offer = admitted.offers.find((o) => o.profile === profile);
				const settings = deps.profileFor(profile);
				if (!offer || !settings) {
					out.push({
						kind: "error",
						message: `${deps.device.name} no longer has the profile "${profile}".`,
					});
					return;
				}
				const key = slotKey(request.spaceId, profile);
				underOffer.set(id, key);
				release = await deps.slots.take(
					key,
					offer.sessionCap,
					controller.signal,
				);
				served = {
					...request,
					call: {
						kind: "session",
						input: offeredSession(call.input, settings, offer.permissionCap),
					},
				};
			}
			try {
				for await (const reply of serveWork(
					deps.device,
					served,
					controller.signal,
				)) {
					out.push(reply);
				}
			} finally {
				release?.();
			}
		} catch (error) {
			out.push({
				kind: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		} finally {
			calls.delete(id);
			underOffer.delete(id);
			out.end();
		}
	}

	return {
		running: () => calls.size,
		withdrawn(spaceId, profile) {
			const key = slotKey(spaceId, profile);
			for (const [id, offer] of underOffer) {
				if (offer === key) calls.get(id)?.abort();
			}
		},
		async whileOnline(next, signal) {
			client = next;
			while (!signal.aborted) {
				try {
					const stream = await next.devices.work(
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
 * - Its owner's run (the Person who starts it is the Person of this
 *   computer's link): their role in the Space starts runs (the Space
 *   document's Member mirror).
 * - Another Person's run: they are a Member whose role uses Offers, this
 *   computer has Offers in force into the Space (its own document holds
 *   them and the Space document lists them), and the call is one an
 *   Offer allows (`offeredCallRefusal`): an offered session, or the run's
 *   own folder work.
 * - It has a Clone of the project, in that Space.
 * - A call that works in a folder works in the run's own worktree.
 */
export async function checkWork(
	request: WorkRequest,
	deps: WorkCheckDeps,
): Promise<string | null> {
	const admitted = await admitWork(request, deps);
	return "refusal" in admitted ? admitted.refusal : null;
}

type WorkCheckDeps = {
	hostId: string;
	db: Database;
	engine: Engine;
	/** This computer as a Device: its id and name. */
	device: Pick<Device, "id" | "name">;
	offers?: () => readonly DeviceOffer[];
};

/**
 * `checkWork`, with what an admitted call runs under: null for its
 * owner's run, else this computer's Offers in force into the Space.
 */
async function admitWork(
	request: WorkRequest,
	deps: WorkCheckDeps,
): Promise<{ refusal: string } | { offers: DeviceOffer[] | null }> {
	const { db, engine } = deps;
	const { spaceId, projectId, personId, runId, call } = request;
	const refuse = (refusal: string) => ({ refusal });
	if ((await engine.exchange.hostSpaces.hostOf(spaceId)) !== deps.hostId) {
		return refuse(
			"This device does not take part in that Space through this Host.",
		);
	}
	const role = await engine.exchange.memberRole(spaceId, personId);
	let offers: DeviceOffer[] | null = null;
	if ((await personOnHost(db, spaceId)) === personId) {
		if (!role || !roleAllows(role, { run: ["start"] })) {
			return refuse("Your role in this Space does not allow starting runs.");
		}
	} else {
		if (!role) {
			return refuse("This device runs steps for Members of this Space only.");
		}
		if (!roleAllows(role, { offer: ["use"] })) {
			return refuse(
				"Your role in this Space does not allow using what others offer.",
			);
		}
		offers = inForce(
			deps.offers?.() ?? [],
			(await engine.offers.list(spaceId)).filter(
				(o) => o.deviceId === deps.device.id,
			),
			spaceId,
		);
		const refusal = offeredCallRefusal(call, deps.device.name, offers);
		if (refusal !== null) return refuse(refusal);
	}
	const repoPath = await clonePathOf(db)(projectId, spaceId);
	if (repoPath === null) {
		return refuse(
			"This device does not have this project. Add its folder there first.",
		);
	}
	if (
		call.kind === "worktree" &&
		(call.run.id !== runId || call.run.projectId !== projectId)
	) {
		return refuse("This device adds a folder only for the run that asks.");
	}
	const cwd = cwdOf(call);
	if (cwd !== null) {
		const own =
			runId === null
				? null
				: worktreeLocation(repoPath, runId.slice(0, 8)).worktreePath;
		if (own === null || (cwd !== own && !cwd.startsWith(`${own}/`))) {
			return refuse("This device works only in the run's own folder.");
		}
	}
	return { offers };
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

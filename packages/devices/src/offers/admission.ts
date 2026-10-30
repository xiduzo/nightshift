import { roleAllows } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import type {
	Device,
	OfferedSessionInput,
	PeerProjects,
	PlacedRun,
	SessionInput,
} from "@nightshift/engine";
import {
	memberRole,
	type SpaceDocuments,
	worktreeLocation,
} from "@nightshift/engine/projects";
import {
	type AgentProfileSettings,
	isAgentProfile,
	type ProfileSettings,
} from "@nightshift/flows";
import { Refusal, wordsFor } from "@nightshift/refusal";
import type { WorkCall, WorkRelay, WorkReply, WorkRequest } from "../contract";
import { createHostSpaces, personInSpace, personOnHost } from "../links";
import { selfOwnerId } from "../registry";
import { remoteDevice, serveWork } from "../work";
import type { OfferedSessions } from "./engine-offers";
import {
	clampToCap,
	type DeviceOffer,
	inForce,
	offerFor,
	offersNothingOr,
	spaceOffers,
} from "./offers";

/**
 * Offer admission: whether this computer, as a Device, serves one call of
 * a run, and how. Every call of another Person's run passes here, by
 * either path: in process when this computer walks the run itself
 * (`deviceFor`), and after the wire when a Walker elsewhere sends it
 * through a Host (`serve`). So every Offer check has one home, from this
 * computer's own Replica:
 *
 * - A call names its run's starter. A call with none is refused.
 * - The starter is a Member of the run's Space, and their role uses what
 *   others offer (`offer.use`), at every call.
 * - This computer has Offers in force into the Space: its own document
 *   holds them, and the Space document lists them.
 * - The call is one an Offer allows: a session of an offered profile, or
 *   the run's own folder work (`offeredCallRefusal`).
 * - The call works in this computer's Clone of the project, and only in
 *   the run's own worktree.
 * - An offered session runs the profile as its owner set it, with the
 *   permission mode no wider than the Offer's cap (`offeredSession`), and
 *   waits for one of the Offer's sessions while it runs its session cap.
 *   One slot map per Offer counts the sessions of both paths, and a
 *   reload hands it to the next engine (`OfferUse`).
 * - Withdrawing an Offer aborts the calls under it (`withdrawn`). A
 *   session it aborts answers with why, so the step of a run walked
 *   elsewhere fails at once: its Walker does not wait for this Device as
 *   for one that went quiet. A run walked here is stopped first
 *   (`EngineOffers.withdraw`): its step ends as stopped.
 *
 * Its owner's run that comes over the wire passes here too: their role
 * starts runs, and the Clone and folder rules hold. Its owner's run that
 * this computer walks itself is this computer as is: no Offer is in play.
 */

/** The refusal of a call whose run names no starter. */
export const NO_STARTER =
	"Night Shift does not know who started this run. Start it again to run its steps.";

/** Where a call that came over the wire comes from. */
export type CallVia =
	/** Over this computer's link to that Host: a run it walks or relays. */
	| { hostId: string }
	/** On a Host, from a Walker elsewhere, in a Space this Host keeps. */
	| { keptHere: true };

/** A call of a run this computer walks itself. */
const WALKED_HERE = { walkedHere: true } as const;

/** Why a session that waited for a free one of the Offer did not start: it was stopped. */
const SESSION_STOPPED = "The session was stopped.";
type Via = CallVia | typeof WALKED_HERE;

export type OfferAdmission = {
	/**
	 * Serves one call that came over the wire, after every check: its
	 * owner's run as the call asks, another Person's under the Offer it
	 * names. Never throws: a refusal or a failure is an `error` reply.
	 * Aborting `signal` ends it.
	 */
	serve(
		request: WorkRequest,
		via: CallVia,
		signal: AbortSignal,
	): AsyncGenerator<WorkReply>;
	/**
	 * This computer as the Device of a run it walks itself
	 * (`PlacementDeps.localFor`): as is for its owner's run, else every
	 * call through the admission, as if it came over the wire.
	 */
	deviceFor(
		run: Pick<PlacedRun, "id" | "spaceId" | "projectId" | "plan">,
	): Device;
	/** This computer's Offers into a Space that are in force. */
	inForce(spaceId: string): Promise<DeviceOffer[]>;
	/** Aborts the calls running here under a withdrawn Offer (`profile`: its id). */
	withdrawn(spaceId: string, profile: string): void;
};

export function createOfferAdmission(deps: {
	db: Database;
	/** This computer as a Device: it serves every admitted call. */
	device: Device;
	documents: SpaceDocuments;
	/** The folder of a project's Clone on this computer: a call that works in it needs one. */
	projects: Pick<PeerProjects, "clonePath">;
	/**
	 * This computer's own Offers (its Device document), with the names
	 * their profiles have now. Without it, none.
	 */
	ownOffers?: () => readonly DeviceOffer[];
	/** A profile of this computer by its id, as its owner set it. */
	profileFor?: (id: string) => ProfileSettings | null;
	/** The offered sessions of the runs this computer walks: what withdrawing an Offer stops. */
	sessions?: Pick<OfferedSessions, "relay">;
	/** The Offers in use, kept across a reload (`createOfferUse`). Default: its own. */
	use?: OfferUse;
}): OfferAdmission {
	const { db, device, documents } = deps;
	const hostSpaces = createHostSpaces(db);
	const { slots, calls } = deps.use ?? createOfferUse();

	async function offersHere(spaceId: string): Promise<DeviceOffer[]> {
		return inForce(
			deps.ownOffers?.() ?? [],
			spaceOffers(await documents.open(spaceId), device.id),
			spaceId,
		);
	}

	/** This computer's owner, as the Space's Host knows them. */
	async function ownerHere(spaceId: string): Promise<string | null> {
		return personInSpace(db, spaceId, await selfOwnerId(db));
	}

	/**
	 * This computer's owner in a Space, by where a call comes from.
	 * Undefined: this computer serves no call of that Space that way.
	 */
	async function ownerVia(
		spaceId: string,
		via: Via,
	): Promise<string | null | undefined> {
		if ("walkedHere" in via) return ownerHere(spaceId);
		const hostOf = await hostSpaces.hostOf(spaceId);
		if ("hostId" in via) {
			return hostOf === via.hostId ? personOnHost(db, spaceId) : undefined;
		}
		return hostOf === null ? selfOwnerId(db) : undefined;
	}

	/** Why a call is refused, or what it runs under: null for its owner's run, else the Offers in force. */
	async function admit(
		request: WorkRequest,
		via: Via,
	): Promise<{ refusal: string } | { offers: DeviceOffer[] | null }> {
		const { spaceId, projectId, personId, runId, call } = request;
		const refuse = (refusal: string) => ({ refusal });
		if (!personId) return refuse(NO_STARTER);
		const owner = await ownerVia(spaceId, via);
		if (owner === undefined) {
			return refuse(
				"This device does not take part in that Space through this Host.",
			);
		}
		const role = memberRole(await documents.open(spaceId), personId);
		let offers: DeviceOffer[] | null = null;
		if (owner === personId) {
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
			offers = await offersHere(spaceId);
			const refusal = offeredCallRefusal(call, device.name, offers);
			if (refusal !== null) return refuse(refusal);
		}
		if (!NEEDS_CLONE.has(call.kind)) return { offers };
		const repoPath = await deps.projects.clonePath(projectId, spaceId);
		if (repoPath === null) {
			return refuse(
				"This device does not have this project. Add its folder there first.",
			);
		}
		if (
			(call.kind === "worktree" || call.kind === "receiveHandOff") &&
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

	async function* serve(
		request: WorkRequest,
		via: Via,
		signal: AbortSignal,
	): AsyncGenerator<WorkReply> {
		try {
			const admitted = await admit(request, via);
			if ("refusal" in admitted) {
				yield { kind: "error", message: admitted.refusal };
				return;
			}
			const { call } = request;
			if (
				admitted.offers === null ||
				call.kind !== "session" ||
				!("offered" in call.input)
			) {
				yield* serveWork(device, request, signal);
				return;
			}
			// Another Person's session: this computer's own profile, its caps.
			// The node names the profile by its id. A Walker of an older
			// Night Shift names it by its name, which `ownOffers` keeps
			// current: both find the offered profile, also after a rename.
			const { profile } = call.input.offered;
			const offer = offerFor(admitted.offers, profile);
			const found = offer ? (deps.profileFor?.(offer.profile) ?? null) : null;
			// Only an Agent Profile runs a session.
			const settings = found && isAgentProfile(found) ? found : null;
			if (!offer || !settings) {
				yield {
					kind: "error",
					message: `${device.name} no longer has the profile "${profile}".`,
				};
				return;
			}
			// Keyed by the profile's id: a rename keeps the count and the calls.
			const key = offerKey(request.spaceId, offer.profile);
			const stop = new AbortController();
			const both = AbortSignal.any([signal, stop.signal]);
			const forget = calls.add(request.spaceId, offer.profile, () =>
				stop.abort(),
			);
			/** Its owner withdrew the Offer: the run's step fails and says why. */
			const withdrawn = () => stop.signal.aborted && !signal.aborted;
			let release: (() => void) | null = null;
			try {
				release = await slots.take(key, offer.sessionCap, both);
				for await (const reply of serveWork(
					device,
					{
						...request,
						call: {
							kind: "session",
							input: offeredSession(call.input, settings, offer.permissionCap),
						},
					},
					both,
				)) {
					if (withdrawn()) break;
					yield reply;
				}
			} catch (error) {
				if (!withdrawn()) throw error;
			} finally {
				release?.();
				forget();
			}
			// Not a session that ended or a Device that went quiet, which a
			// Walker waits for: an error, so the step fails at once.
			if (withdrawn()) {
				yield {
					kind: "error",
					message: `${device.name} no longer offers "${profile}" to this Space. Choose another device for this step.`,
				};
			}
		} catch (error) {
			// Words for people go to the Walker. A failure's details stay here.
			if (!(error instanceof Refusal)) {
				console.error(
					`[offers] a ${request.call.kind} call for ${request.spaceId} failed:`,
					error,
				);
			}
			yield { kind: "error", message: wordsFor(error) };
		}
	}

	/** The calls of runs walked here, through the admission: the in-process path. */
	const walkedHere: WorkRelay = {
		call: (_deviceId, request, signal) =>
			serve(request, WALKED_HERE, signal ?? new AbortController().signal),
		online: () => true,
	};
	const local = deps.sessions?.relay(walkedHere) ?? walkedHere;

	return {
		serve,
		inForce: offersHere,
		withdrawn: (spaceId, profile) => calls.withdrawn(spaceId, profile),

		deviceFor(run) {
			const { personId } = run.plan;
			const admitted = remoteDevice(local, device, {
				spaceId: run.spaceId,
				projectId: run.projectId,
				// No starter: refused in this process, never sent.
				personId: personId ?? "",
				runId: run.id,
			});
			/** The Device of one call: as is for its owner's run, else admitted call by call. */
			const pick = async (): Promise<Device> =>
				personId !== null && personId === (await ownerHere(run.spaceId))
					? device
					: admitted;
			return {
				id: device.id,
				name: device.name,
				state: async () => (await pick()).state(),
				capabilities: async (query) => (await pick()).capabilities(query),
				flows: async (projectId) => (await pick()).flows(projectId),
				async *session(input) {
					yield* (await pick()).session(input);
				},
				async *exec(input) {
					yield* (await pick()).exec(input);
				},
				callTool: async (input) => (await pick()).callTool(input),
				decide: (async (input: Parameters<Device["decide"]>[0]) =>
					(await pick()).decide(input as never)) as Device["decide"],
				worktree: async (run) => (await pick()).worktree(run),
				handOff: async (input) => (await pick()).handOff(input),
				receiveHandOff: async (input) => (await pick()).receiveHandOff(input),
				itemBranch: async (input) => (await pick()).itemBranch(input),
				// Only when this computer tells what a step changed.
				...(device.snapshotWorktree && device.worktreeChanges
					? {
							snapshotWorktree: async (input: SnapshotInput) =>
								snapshotsOf(await pick()).snapshotWorktree(input),
							worktreeChanges: async (input: ChangesInput) =>
								snapshotsOf(await pick()).worktreeChanges(input),
						}
					: {}),
			};
		},
	};
}

/** The key of an Offer's sessions and calls. */
const offerKey = (spaceId: string, profile: string) => `${spaceId}/${profile}`;

type SnapshotInput = Parameters<NonNullable<Device["snapshotWorktree"]>>[0];
type ChangesInput = Parameters<NonNullable<Device["worktreeChanges"]>>[0];

/**
 * The snapshot calls of a Device. `deviceFor` has them only when this
 * computer has them, and its admitted path always does.
 */
function snapshotsOf(
	device: Device,
): Required<Pick<Device, "snapshotWorktree" | "worktreeChanges">> {
	const { snapshotWorktree, worktreeChanges } = device;
	if (!snapshotWorktree || !worktreeChanges) {
		throw new Error(`${device.name} takes no snapshots of a worktree.`);
	}
	return { snapshotWorktree, worktreeChanges };
}

/** The calls that work in the project's Clone; a model or a tool needs none. */
const NEEDS_CLONE: ReadonlySet<WorkCall["kind"]> = new Set([
	"flows",
	"worktree",
	"itemBranch",
	"handOff",
	"receiveHandOff",
	"snapshotWorktree",
	"worktreeChanges",
	"session",
	"exec",
]);

/** The folder a call works in, for the calls that name one. */
function cwdOf(call: WorkCall): string | null {
	switch (call.kind) {
		case "session":
		case "exec":
			return call.input.cwd;
		case "itemBranch":
		case "handOff":
		case "snapshotWorktree":
		case "worktreeChanges":
			return call.cwd;
		default:
			return null;
	}
}

/**
 * The check of one call of another Person's run, given this computer's
 * Offers in force into the run's Space: an offered session of one of
 * them, or the run's own folder work (its flows, its worktree, its item
 * branches, the Hand-off of its work to and from it, the snapshots that
 * tell what a step changed in it). Anything
 * else is refused: a command, a tool, the decider, a session it did not
 * offer, and its capabilities (private to its owner). Null when it serves
 * the call.
 */
function offeredCallRefusal(
	call: WorkCall,
	deviceName: string,
	offers: readonly DeviceOffer[],
): string | null {
	if (offers.length === 0) return offersNothingOr(deviceName, offers);
	const refused = `${deviceName} runs only the profiles its owner offers to this Space. ${offersNothingOr(deviceName, offers)}`;
	switch (call.kind) {
		case "flows":
		case "worktree":
		case "itemBranch":
		case "handOff":
		case "receiveHandOff":
		case "snapshotWorktree":
		case "worktreeChanges":
			return null;
		case "session": {
			if (!("offered" in call.input)) return refused;
			const { profile } = call.input.offered;
			return offerFor(offers, profile) !== undefined
				? null
				: offersNothingOr(deviceName, offers, profile);
		}
		default:
			return refused;
	}
}

/**
 * An offered session as this computer runs it: its profile as its owner
 * set it (harness, model, effort, CLI tools, connections), and the
 * permission mode the node asks for, else the profile's, never wider than
 * the Offer's cap.
 */
function offeredSession(
	input: Omit<OfferedSessionInput, "signal">,
	profile: AgentProfileSettings,
	cap: DeviceOffer["permissionCap"],
): Omit<SessionInput, "signal"> {
	const { offered, ...rest } = input;
	return {
		...rest,
		harness: profile.harness,
		model: profile.model,
		permissionMode: clampToCap(
			offered.permissionMode ?? profile.permissionMode,
			cap,
		),
		...(profile.effort !== undefined ? { effort: profile.effort } : {}),
		...(profile.clis.length > 0 ? { clis: profile.clis } : {}),
		...(profile.connections.length > 0
			? { connections: profile.connections }
			: {}),
	};
}

/**
 * The Offers in use on this computer: the sessions running under each
 * Offer (`slots`, at most its cap at once) and the calls under each
 * (`calls`, to abort when it is withdrawn). They outlive an admission: a
 * `bun --hot` reload hands them to the next engine's, so a session that
 * runs on through the reload still counts against its Offer. Keyed by the
 * Space and the profile's id.
 */
export type OfferUse = {
	slots: {
		/**
		 * Waits for a free session of the Offer, first come first served, and
		 * resolves to its release. A session over the cap waits; it is not
		 * refused. Rejects when `signal` aborts while it waits.
		 */
		take(key: string, cap: number, signal: AbortSignal): Promise<() => void>;
		/** The sessions running under the Offer now. */
		running(key: string): number;
	};
	calls: {
		/** Notes a call under an Offer; the returned function forgets it. */
		add(spaceId: string, profile: string, abort: () => void): () => void;
		/** Aborts the calls under a withdrawn Offer. */
		withdrawn(spaceId: string, profile: string): void;
	};
};

export function createOfferUse(): OfferUse {
	return { slots: createOfferSlots(), calls: createOfferCalls() };
}

function createOfferSlots(): OfferUse["slots"] {
	const running = new Map<string, number>();
	const waiting = new Map<string, (() => void)[]>();

	function release(key: string) {
		running.set(key, (running.get(key) ?? 1) - 1);
		waiting.get(key)?.shift()?.();
	}

	return {
		running: (key) => running.get(key) ?? 0,
		async take(key, cap, signal) {
			while ((running.get(key) ?? 0) >= cap) {
				if (signal.aborted) throw new Refusal("conflict", SESSION_STOPPED);
				await new Promise<void>((resolve, reject) => {
					const queue = waiting.get(key) ?? [];
					waiting.set(key, queue);
					const wake = () => {
						signal.removeEventListener("abort", stop);
						resolve();
					};
					const stop = () => {
						const at = queue.indexOf(wake);
						if (at >= 0) queue.splice(at, 1);
						reject(new Refusal("conflict", SESSION_STOPPED));
					};
					queue.push(wake);
					signal.addEventListener("abort", stop, { once: true });
				});
			}
			running.set(key, (running.get(key) ?? 0) + 1);
			let released = false;
			return () => {
				if (released) return;
				released = true;
				release(key);
			};
		},
	};
}

function createOfferCalls(): OfferUse["calls"] {
	const running = new Map<symbol, { key: string; abort: () => void }>();
	return {
		add(spaceId, profile, abort) {
			const id = Symbol(profile);
			running.set(id, { key: offerKey(spaceId, profile), abort });
			return () => running.delete(id);
		},
		withdrawn(spaceId, profile) {
			const key = offerKey(spaceId, profile);
			for (const call of running.values()) if (call.key === key) call.abort();
		},
	};
}

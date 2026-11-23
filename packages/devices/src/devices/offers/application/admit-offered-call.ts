import type { Permissions } from "@nightshift/auth";
import type {
	Device,
	PeerContext,
	PeerProjects,
	PlacedRun,
	ReadFileInput,
	RunRef,
	SpaceDocument,
	SpaceDocuments,
} from "@nightshift/engine";
import { isAgentProfile, type ProfileSettings } from "@nightshift/flows";
import { Refusal, wordsFor } from "@nightshift/refusal";
import type {
	WorkFor,
	WorkRelay,
	WorkReply,
	WorkRequest,
} from "../../../contract";
import { createOfferUse, type OfferUse, offerKey } from "../domain/offer-use";
import {
	cwdOf,
	filesOf,
	GIT_CALLS,
	NEEDS_CLONE,
	NO_STARTER,
	offeredCallRefusal,
	offeredSession,
	runFoldersOf,
	snapshotsOf,
} from "../domain/offered-call";
import type { OfferedSessions } from "../domain/offered-sessions";
import {
	type DeviceOffer,
	inForce,
	offerFor,
	spaceOffers,
} from "../domain/offers";

type RestoreInput = Parameters<NonNullable<Device["restoreWorktree"]>>[0];
type SnapshotInput = Parameters<NonNullable<Device["snapshotWorktree"]>>[0];
type ChangesInput = Parameters<NonNullable<Device["worktreeChanges"]>>[0];

export type AdmitOfferedCallPorts = {
	selfOwnerId: () => Promise<string | null>;
	device: Device;
	documents: SpaceDocuments;
	hostOf(spaceId: string): Promise<string | null>;
	personInSpace(
		spaceId: string,
		personId: string | null,
	): Promise<string | null>;
	personOnHost(spaceId: string): Promise<string | null>;
	memberRole(document: SpaceDocument, personId: string): string | null;
	roleAllows(role: string, need: Permissions): boolean;
	projects: Pick<PeerProjects, "clonePath" | "find">;
	runFolders: PeerContext["runFolders"];
	worktreePath(repoPath: string, shortId: string): string;
	ownOffers?: () => readonly DeviceOffer[];
	profileFor?: (id: string) => ProfileSettings | null;
	sessions?: Pick<OfferedSessions, "relay">;
	use?: OfferUse;
	serve(
		device: Device,
		request: WorkRequest,
		signal: AbortSignal,
	): AsyncGenerator<WorkReply>;
	remote(
		relay: WorkRelay,
		device: { id: string; name: string },
		forRun: WorkFor,
	): Device;
};

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
 *   the run's own worktree. For a project without a folder (ADR 22): only
 *   in the run's own run folder here, and with no git work.
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

/** Where a call that came over the wire comes from. */
export type CallVia =
	/** Over this computer's link to that Host: a run it walks or relays. */
	| { hostId: string }
	/** On a Host, from a Walker elsewhere, in a Space this Host keeps. */
	| { keptHere: true };

/** A call of a run this computer walks itself. */
const WALKED_HERE = { walkedHere: true } as const;

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

export function admitOfferedCall(ports: AdmitOfferedCallPorts): OfferAdmission {
	const { device, documents } = ports;
	const { slots, calls } = ports.use ?? createOfferUse();

	async function offersHere(spaceId: string): Promise<DeviceOffer[]> {
		return inForce(
			ports.ownOffers?.() ?? [],
			spaceOffers(await documents.open(spaceId), device.id),
			spaceId,
		);
	}

	/** This computer's owner, as the Space's Host knows them. */
	async function ownerHere(spaceId: string): Promise<string | null> {
		return ports.personInSpace(spaceId, await ports.selfOwnerId());
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
		const hostOf = await ports.hostOf(spaceId);
		if ("hostId" in via) {
			return hostOf === via.hostId ? ports.personOnHost(spaceId) : undefined;
		}
		return hostOf === null ? ports.selfOwnerId() : undefined;
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
		const role = ports.memberRole(await documents.open(spaceId), personId);
		let offers: DeviceOffer[] | null = null;
		if (owner === personId) {
			if (!role || !ports.roleAllows(role, { run: ["start"] })) {
				return refuse("Your role in this Space does not let you start runs.");
			}
		} else {
			if (!role) {
				return refuse("This device runs steps for Members of this Space only.");
			}
			if (!ports.roleAllows(role, { offer: ["use"] })) {
				return refuse(
					"Your role in this Space does not let you use what others offer.",
				);
			}
			offers = await offersHere(spaceId);
			const refusal = offeredCallRefusal(call, device.name, offers);
			if (refusal !== null) return refuse(refusal);
		}
		if (!NEEDS_CLONE.has(call.kind)) return { offers };
		const own = await ownFolder(request);
		if ("refusal" in own) return own;
		if (
			(call.kind === "worktree" ||
				call.kind === "restoreWorktree" ||
				call.kind === "receiveHandOff" ||
				call.kind === "runFolder") &&
			(call.run.id !== runId || call.run.projectId !== projectId)
		) {
			return refuse("This device adds a folder only for the run that asks.");
		}
		const cwd = cwdOf(call);
		if (cwd !== null) {
			const { folder } = own;
			if (
				folder === null ||
				(cwd !== folder && !cwd.startsWith(`${folder}/`))
			) {
				return refuse("This device works only in the run's own folder.");
			}
		}
		return { offers };
	}

	/**
	 * The one folder the run's calls may work in here: its worktree in this
	 * computer's Clone of the project, or for a project without a folder
	 * its run folder (ADR 22), which takes no git work. Null before the run
	 * exists. Refused without a Clone, and for a call of the other kind.
	 */
	async function ownFolder(
		request: WorkRequest,
	): Promise<{ refusal: string } | { folder: string | null }> {
		const { spaceId, projectId, runId, call } = request;
		const project = await ports.projects
			.find(projectId, spaceId)
			.catch(() => null);
		if (project?.folder === false) {
			if (GIT_CALLS.has(call.kind)) {
				return {
					refusal:
						"This project has no folder. Its runs work in a folder of their own, without git.",
				};
			}
			return { folder: runId === null ? null : ports.runFolders.path(runId) };
		}
		if (call.kind === "runFolder") {
			return {
				refusal:
					"This project has a folder. Its runs work in their own copy of the project.",
			};
		}
		const repoPath = await ports.projects.clonePath(projectId, spaceId);
		if (repoPath === null) {
			return {
				refusal:
					"This device does not have this project. Add its folder there first.",
			};
		}
		return {
			folder:
				runId === null ? null : ports.worktreePath(repoPath, runId.slice(0, 8)),
		};
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
				yield* ports.serve(device, request, signal);
				return;
			}
			// Another Person's session: this computer's own profile, its caps.
			// The node names the profile by its id. A Walker of an older
			// Night Shift names it by its name, which `ownOffers` keeps
			// current: both find the offered profile, also after a rename.
			const { profile } = call.input.offered;
			const offer = offerFor(admitted.offers, profile);
			const found = offer ? (ports.profileFor?.(offer.profile) ?? null) : null;
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
				for await (const reply of ports.serve(
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
	const local = ports.sessions?.relay(walkedHere) ?? walkedHere;

	return {
		serve,
		inForce: offersHere,
		withdrawn: (spaceId, profile) => calls.withdrawn(spaceId, profile),

		deviceFor(run) {
			const { personId } = run.plan;
			const admitted = ports.remote(local, device, {
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
				request: async (input) => (await pick()).request(input),
				// Only when this computer reads files.
				...(device.readFile
					? {
							readFile: async (input: ReadFileInput) =>
								filesOf(await pick()).readFile(input),
						}
					: {}),
				decide: (async (input: Parameters<Device["decide"]>[0]) =>
					(await pick()).decide(input as never)) as Device["decide"],
				worktree: async (run) => (await pick()).worktree(run),
				// Only when this computer makes a run's copy again.
				...(device.restoreWorktree
					? {
							restoreWorktree: async (input: RestoreInput) =>
								(await (await pick()).restoreWorktree?.(input)) ?? null,
						}
					: {}),
				// Only when this computer makes run folders.
				...(device.runFolder
					? {
							runFolder: async (run: RunRef) =>
								runFoldersOf(await pick()).runFolder(run),
						}
					: {}),
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

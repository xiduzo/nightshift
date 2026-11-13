import type { Permissions } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import {
	type Engine,
	type PeerProjects,
	PinNotHereError,
	permissionOf,
	RUN_NOT_FOUND,
	type SpaceArchive,
	type StartRunInput,
	sharedAnswerCosts,
	withoutPrivatePaths,
} from "@nightshift/engine";
import { PROJECT_NOT_FOUND } from "@nightshift/engine/projects";
import { Refusal } from "@nightshift/refusal";
import { ORPCError } from "@orpc/server";
import {
	ANSWER_COSTS_MAX,
	type ArchiveRef,
	type Caller,
	type SyncBatch,
	type SyncCursors,
} from "../contract";
import type { HostSpaces } from "../links";
import type { EngineOffers, OfferAdmission } from "../offers";
import type { DeviceRegistry } from "../registry";
import type { WorkHub } from "../work";
import { mergePersonalHere } from "./personal-merge";
import {
	ForeignRowsError,
	isEmpty,
	MissingProjectError,
	mergeCursors,
} from "./rows";
import type { RunHistoryExchange } from "./run-history";
import type { HostExchange } from "./types";

/**
 * This computer as the Host of run history for its paired Devices: what
 * the Host's router (`hostRouter`) calls for `sync.*`, `archive.*` and
 * the work relay. Every call comes as its Caller, the Device key the Host
 * admitted once (`Devices.admit`); the Host answers it in the name of the
 * Caller's Person, and asks the Caller only what the procedure needs of
 * the Space: a role, a Membership.
 *
 * - It serves only rows of Spaces that Person is a Member of, and never a
 *   Device's own rows back to it. Its own Walker's rows are served the
 *   same way as the ones Devices pushed: its Replica keeps everything.
 * - It takes only a Device's own rows (the runs it walks), in Spaces its
 *   Person is a Member of. Anything else refuses the whole batch.
 * - Rows go out in the order they landed in this Host's Replica
 *   (`RunHistoryExchange.rowsAfter`), so a third Replica stores a moved
 *   run's events as they happened.
 * - A command needs the role that allows the action, checked here. A run
 *   this Host walks gets it at once; any other waits for its Walker, which
 *   takes it on its own stream (`commands`), never behind rows.
 * - The archive keeps what a Walker puts for its own runs, and gives a
 *   Member what it asks of their Spaces' runs: a copy of a step's file
 *   only when its stamp holds the step as this Host's log says.
 * - What the answers of Night Shift's own agents cost comes from the
 *   Device that answered, in its Person's name, and goes to every Member
 *   of its Space, for the Spaces this Host keeps (`answerCosts`).
 * - A Walker's paths (its worktree, its transcripts and logs on disk) stay
 *   with its owner's Replicas: the Host drops them from the rows of a
 *   Device of another Person before it keeps them, and from the rows it
 *   serves to a Device whose owner is not the Walker's
 *   (`withoutPrivatePaths`).
 */

/** How long a stream with nothing new waits before it looks again. */
const STREAM_IDLE_MS = 20_000;

/** The role every start of a run and every lease of a Space asks for. */
const STARTS_RUNS: Permissions = { run: ["start"] };

/** What a person reads when the run of an output they pinned has not reached this Host yet. */
export const pinNotOnHost = (nodeId: string) =>
	`The output you pinned on "${nodeId}" is not on the computer that keeps this Space yet. Try again in a moment.`;

export function createHostExchange(deps: {
	db: Database;
	/**
	 * This Host's engine (`PeerEngine`): its run history, the Offers of its
	 * Spaces, its admission of the calls of runs a Device walks with steps
	 * here, and its Projects, where a Device's Clone and the Projects of
	 * its personal Space are recorded. A Space a Host keeps (`hostSpaces`)
	 * is not this Host's to change.
	 */
	engine: Engine & {
		exchange: RunHistoryExchange;
		offers: EngineOffers;
		admission: Pick<OfferAdmission, "serve">;
		projects: Pick<
			PeerProjects,
			| "recordClone"
			| "setClones"
			| "addFromRemote"
			| "defineWithoutFolder"
			| "matching"
			| "take"
		>;
		hostSpaces: Pick<HostSpaces, "hostOf">;
		/** Its Space archive: the knowledge content its Devices copy here, by hash (ADR 4). */
		archive: Pick<SpaceArchive, "here">;
	};
	/** The Devices paired here: the owners of the Walkers it serves, and what a Device says of itself. */
	registry: Pick<DeviceRegistry, "get" | "describe">;
	/** This Host's Device id: the Walker of its own runs. */
	selfId: string;
	/** The Person who owns this Host: the owner of its own Walker's paths. */
	ownerId: string;
	/** The calls of runs this Host walks, for the Devices they are placed on. */
	work: WorkHub;
}): HostExchange {
	const { db, engine, registry } = deps;
	const { exchange } = engine;
	const answerCosts = sharedAnswerCosts(db);
	/**
	 * The stops of the calls Walkers make through this Host with a
	 * `stopId`, by the Walker's Device and that id, while the call is open.
	 */
	const stops = new Map<string, AbortController>();
	const stopKey = (caller: Caller, id: string) =>
		JSON.stringify([caller.deviceId, id]);

	function forbidden(message: string): never {
		throw new ORPCError("FORBIDDEN", { message });
	}

	/** The Person who owns a Walker, as this Host knows it. */
	async function ownerOf(walkerId: string): Promise<string | null> {
		if (walkerId === deps.selfId) return deps.ownerId;
		return (await registry.get(walkerId))?.ownerId ?? null;
	}

	/** The rows of `spaces` after `cursors` (default: the Person's Spaces), every Walker's but the Device's own. */
	async function batch(
		caller: Caller,
		cursors: SyncCursors,
		withCommands = true,
		spaces?: readonly string[],
	): Promise<SyncBatch> {
		const { rows, cursors: moved } = await exchange.rowsAfter({
			spaces: spaces ?? (await caller.spaces()),
			cursors,
			except: caller.deviceId,
		});
		const owners = new Map<string, string | null>();
		for (const walkerId of new Set(rows.runs.map((r) => r.walkerId))) {
			owners.set(walkerId, await ownerOf(walkerId));
		}
		return {
			rows: withoutPrivatePaths(
				rows,
				(walkerId) => owners.get(walkerId) === caller.personId,
			),
			cursors: moved,
			commands: withCommands
				? await exchange.commands.pendingFor(caller.deviceId)
				: [],
			follows: exchange.feeds.wanted(caller.deviceId),
		};
	}

	/**
	 * Resolves when rows land that the Device lacks (of `on.rows`' Spaces,
	 * another Walker's), the Commands change (with `commands`), the steps
	 * someone follows of the Device's runs change, the time is up, or the
	 * signal aborts.
	 */
	function change(
		signal: AbortSignal,
		deviceId: string,
		on: { rows: readonly string[] | null; commands: boolean },
	): Promise<void> {
		return new Promise((resolve) => {
			const done = () => {
				off();
				offFollows();
				clearTimeout(timer);
				signal.removeEventListener("abort", done);
				resolve();
			};
			const off = on.commands
				? exchange.commands.onChanged(done)
				: () => undefined;
			const offFollows = on.rows
				? exchange.feeds.onWanted(deviceId, done)
				: () => false;
			const timer = setTimeout(done, STREAM_IDLE_MS);
			// Not the rows this Device pushed: it has them.
			if (on.rows) {
				void exchange
					.landed(signal, STREAM_IDLE_MS, {
						spaces: on.rows,
						except: deviceId,
					})
					.then(done);
			}
			if (signal.aborted) done();
			else signal.addEventListener("abort", done, { once: true });
		});
	}

	/** The steps of the batch's follows, as one string to compare. */
	const followsOf = (batch: SyncBatch) =>
		batch.follows
			.map((f) => f.stepId)
			.sort()
			.join();

	/** Starts a run placed on another Device, for the Caller's Person: this Host walks it. */
	async function startFor(
		caller: Caller,
		input: StartRunInput & { spaceId: string },
	): Promise<{ runId: string }> {
		const { spaceId, ...start } = input;
		await caller.may(spaceId, STARTS_RUNS);
		const run = await engine
			.space(spaceId, { personId: caller.personId })
			.startRun({ ...start, startedBy: caller.personId });
		return { runId: run.id };
	}

	return {
		pull: (caller, { cursors }) => batch(caller, cursors),

		async *stream(caller, input, signal) {
			let at = input.cursors;
			const withCommands = input.commands !== false;
			let sentCommands = "";
			let sentFollows = "";
			while (!signal?.aborted) {
				// Read again each cycle: a long stream follows a change of Membership.
				const spaces = await caller.spaces();
				const cycle = new AbortController();
				const signals = signal ? [signal, cycle.signal] : [cycle.signal];
				// Listen before reading, so nothing lands unseen between the two.
				const changed = change(AbortSignal.any(signals), caller.deviceId, {
					rows: spaces,
					commands: withCommands,
				});
				try {
					const next = await batch(caller, at, withCommands, spaces);
					const commands = next.commands.map((c) => c.id).join();
					const follows = followsOf(next);
					if (
						!isEmpty(next.rows) ||
						commands !== sentCommands ||
						follows !== sentFollows
					) {
						at = mergeCursors(at, next.cursors);
						sentCommands = commands;
						sentFollows = follows;
						yield next;
						continue;
					}
					await changed;
				} finally {
					cycle.abort();
				}
			}
		},

		async *commands(caller, signal) {
			let sent: string | null = null;
			while (!signal?.aborted) {
				const cycle = new AbortController();
				const signals = signal ? [signal, cycle.signal] : [cycle.signal];
				// Listen before reading, so no Command is kept unseen between the two.
				const changed = change(AbortSignal.any(signals), caller.deviceId, {
					rows: null,
					commands: true,
				});
				try {
					const commands = await exchange.commands.pendingFor(caller.deviceId);
					const ids = commands.map((c) => c.id).join();
					if (ids !== sent) {
						sent = ids;
						yield { commands };
						continue;
					}
					await changed;
				} finally {
					cycle.abort();
				}
			}
		},

		async push(caller, rows) {
			try {
				// Another Person's Device: its paths never land in this Replica.
				const kept =
					caller.personId === deps.ownerId ? rows : withoutPrivatePaths(rows);
				const added = await exchange.ingest(kept, {
					walker: caller.deviceId,
					spaces: await caller.spaces(),
				});
				return { events: added.length };
			} catch (error) {
				// A row of another Walker or Space: never taken. A project the
				// Space document has not brought yet: not yet.
				if (error instanceof ForeignRowsError) forbidden(error.message);
				if (error instanceof MissingProjectError) {
					throw new ORPCError("CONFLICT", { message: error.message });
				}
				throw error;
			}
		},

		async answerCosts(caller, input) {
			// Only the Spaces of the Person that this Host keeps: another
			// Host's Space has its own costs.
			const spaces: string[] = [];
			for (const spaceId of await caller.spaces()) {
				if ((await engine.hostSpaces.hostOf(spaceId)) === null) {
					spaces.push(spaceId);
				}
			}
			const taken = await answerCosts.take(
				input.rows.filter((row) => spaces.includes(row.spaceId)),
				{ deviceId: caller.deviceId, personId: caller.personId },
			);
			// One more than a call carries says whether more wait.
			const rows = await answerCosts.after({
				spaces,
				cursors: input.cursors,
				selfId: deps.selfId,
				limit: ANSWER_COSTS_MAX + 1,
			});
			return {
				taken,
				rows: rows.slice(0, ANSWER_COSTS_MAX),
				more: rows.length > ANSWER_COSTS_MAX,
			};
		},

		async command(caller, input) {
			const owner = await exchange.runOwner(input.runId);
			if (!owner || !(await caller.member(owner.spaceId))) {
				throw new Refusal("not-found", RUN_NOT_FOUND);
			}
			await caller.may(owner.spaceId, permissionOf(input.kind));
			if (owner.walkerId === deps.selfId) {
				// This Host walks the run: the action is a local one.
				await engine
					.space(owner.spaceId, { personId: caller.personId })
					.act(input.runId, input);
				return;
			}
			if (owner.walkerId === caller.deviceId) {
				forbidden("This device runs this run. Act on it there.");
			}
			await exchange.commands.enqueue({
				...input,
				spaceId: owner.spaceId,
				walkerId: owner.walkerId,
				personId: caller.personId,
			});
		},

		async commandDone(caller, input) {
			await exchange.commands.done(input.id, caller.deviceId, input.error);
		},

		async leaseTake(caller, input) {
			await mayLease(caller, input.spaceId);
			return engine.leases.take({ ...input, walkerId: caller.deviceId });
		},

		async leaseRenew(caller, input) {
			await mayLease(caller, input.spaceId);
			return engine.leases.renew({ ...input, walkerId: caller.deviceId });
		},

		async leaseRelease(caller, input) {
			await mayLease(caller, input.spaceId);
			await engine.leases.release({ ...input, walkerId: caller.deviceId });
		},

		async addProject(caller, input) {
			await caller.may(input.spaceId, { project: ["add"] });
			return engine.projects.addFromRemote(input.spaceId, {
				name: input.name,
				remote: input.remote,
			});
		},

		async addWithoutFolder(caller, input) {
			await caller.may(input.spaceId, { project: ["add"] });
			return engine.projects.defineWithoutFolder(input.spaceId, {
				name: input.name,
			});
		},

		async addClone(caller, input) {
			await caller.may(input.spaceId, { project: ["add"] });
			await engine.projects.recordClone(input.spaceId, {
				projectId: input.projectId,
				deviceId: caller.deviceId,
				deviceName: input.deviceName,
			});
		},

		async setClones(caller, input) {
			await caller.may(input.spaceId, { project: ["add"] });
			// The Device's own name and kind, as it says them each time it links.
			await registry.describe(caller.deviceId, {
				name: input.deviceName,
				dev: input.dev === true,
				machine: input.machine,
			});
			// Only the Caller's own Device: never another Device's Clones.
			return engine.projects.setClones(input.spaceId, {
				deviceId: caller.deviceId,
				deviceName: input.deviceName,
				projectIds: input.projectIds,
			});
		},

		async offer(caller, input) {
			await caller.may(
				input.spaceId,
				{ offer: ["make"] },
				"Your role in this Space does not let you offer profiles.",
			);
			await engine.offers.publish({
				...input,
				profileName: input.profileName ?? input.profile,
				deviceId: caller.deviceId,
				by: caller.personId,
			});
		},

		async withdrawOffer(caller, input) {
			// The Device's owner withdraws its own Offer, whatever their role now.
			if (!(await caller.member(input.spaceId))) {
				throw new Refusal("not-found", "That Space does not exist.");
			}
			await engine.offers.withdraw({
				...input,
				deviceId: caller.deviceId,
				by: caller.personId,
			});
		},

		async archivePut(caller, { ref, content, stamp }) {
			await ownRun(caller, ref);
			await exchange.archive.write(ref, content, stamp);
		},

		async archiveGet(caller, { ref }) {
			const owner = await exchange.runOwner(ref.runId);
			if (
				!owner ||
				owner.spaceId !== ref.spaceId ||
				!(await caller.member(owner.spaceId))
			) {
				return null;
			}
			if (ref.kind !== "checkpoint") {
				const step = await exchange.stepOwner(ref.stepId);
				if (step?.runId !== ref.runId) return null;
			}
			// Its own files are the step as it is now. A copy of a step's file
			// of an earlier end is not there yet (`RunHistoryExchange.archive`).
			return owner.walkerId === deps.selfId
				? exchange.archive.own(ref)
				: exchange.archive.read(ref);
		},

		async knowledgePut(caller, { spaceId, sha256, content }) {
			if (!(await caller.member(spaceId))) {
				throw new Refusal("not-found", "That Space does not exist.");
			}
			await caller.may(spaceId, STARTS_RUNS);
			// A Space another Host keeps is not this Host's to keep.
			if ((await engine.hostSpaces.hostOf(spaceId)) !== null) {
				throw new Refusal(
					"unavailable",
					"This computer does not keep the knowledge of that Space.",
				);
			}
			await engine.archive.here.write({
				ref: { kind: "content", spaceId, sha256 },
				content: new Uint8Array(Buffer.from(content, "base64")),
			});
		},

		async knowledgeGet(caller, { spaceId, sha256 }) {
			if (
				!(await caller.member(spaceId)) ||
				(await engine.hostSpaces.hostOf(spaceId)) !== null
			) {
				return null;
			}
			const content = await engine.archive.here.read({
				kind: "content",
				spaceId,
				sha256,
			});
			return content ? Buffer.from(content).toString("base64") : null;
		},

		async *archiveFollow(caller, { step, afterSeq }, signal) {
			const owner = await exchange.runOwner(step.runId);
			const found = await exchange.stepOwner(step.stepId);
			if (
				!owner ||
				owner.spaceId !== step.spaceId ||
				found?.runId !== step.runId ||
				!(await caller.member(owner.spaceId))
			) {
				forbidden("You are not a member of the Space of this run.");
			}
			yield* exchange.feeds.follow(
				step,
				afterSeq,
				signal ?? new AbortController().signal,
			);
		},

		async archiveTail(caller, { step, entries, ended }) {
			await ownRun(caller, { kind: "transcript", ...step });
			exchange.feeds.deliver(caller.deviceId, step, entries, ended);
		},

		async *work(caller, input, signal) {
			yield* deps.work.take(
				caller.deviceId,
				signal ?? new AbortController().signal,
				input.running,
				{ stopWaits: input.stopWaits === true },
			);
		},

		async workReply(caller, input) {
			return { known: deps.work.reply(caller.deviceId, input) };
		},

		startRun: startFor,

		async startTest(caller, input) {
			// The Device found each pinned output in its own log first: one
			// that is not here yet is on its way (ADR 27).
			return startFor(caller, input).catch((error: unknown) => {
				if (error instanceof PinNotHereError) {
					throw new Refusal("unavailable", pinNotOnHost(error.nodeId));
				}
				throw error;
			});
		},

		async devices(caller, input) {
			if (!(await caller.member(input.spaceId))) {
				throw new Refusal("not-found", PROJECT_NOT_FOUND);
			}
			return engine
				.space(input.spaceId, { personId: caller.personId })
				.listDevices(input.projectId);
		},

		async *call(caller, { deviceId, request, stopId }, signal) {
			// Known before its first wait: a stop right after the start finds it.
			const key = stopId === undefined ? null : stopKey(caller, stopId);
			const stop = new AbortController();
			if (key) stops.set(key, stop);
			try {
				// The Walker asks in the name of its run's Person: its own.
				if (request.personId !== caller.personId) {
					forbidden("A device may ask only for its own Person's runs.");
				}
				await caller.may(request.spaceId, STARTS_RUNS);
				if (deviceId === deps.selfId) {
					// Its owner's run, or another Person's through its Offers. A
					// stop ends the session here, and the stream after its cleanup.
					const ended = signal ?? new AbortController().signal;
					yield* engine.admission.serve(
						request,
						{ keptHere: true },
						key ? AbortSignal.any([ended, stop.signal]) : ended,
					);
					return;
				}
				const paired = await registry.get(deviceId);
				if (
					!paired ||
					paired.revokedAt ||
					(paired.ownerId !== caller.personId &&
						!(await offersInto(deviceId, request.spaceId)))
				) {
					yield {
						kind: "error",
						message:
							"That device is not one of yours on this Host, and it offers nothing to this Space.",
					};
					return;
				}
				// Another Person's Device checks its Offers again itself.
				yield* deps.work.call(
					deviceId,
					request,
					signal,
					key ? stop.signal : undefined,
				);
			} finally {
				if (key && stops.get(key) === stop) stops.delete(key);
			}
		},

		async stop(caller, { id }) {
			const stop = stops.get(stopKey(caller, id));
			stop?.abort();
			return { known: stop !== undefined };
		},

		async mergePersonal(caller, input) {
			// A Guest Host never merges: it keeps only shared Spaces.
			if (!caller.device.homeHost) {
				throw new Refusal(
					"forbidden",
					"This Host is not the home Host of this device. Only a home Host takes its personal Space.",
				);
			}
			return mergePersonalHere(
				{
					db,
					projects: engine.projects,
					hostedElsewhere: async (spaceId) =>
						(await engine.hostSpaces.hostOf(spaceId)) !== null,
				},
				caller,
				{ name: caller.device.name },
				input,
			);
		},

		async reachable(caller, { deviceId }) {
			if (deviceId === deps.selfId) return true;
			const paired = await registry.get(deviceId);
			if (!paired || paired.revokedAt) return false;
			if (paired.ownerId !== caller.personId) {
				// Another Person's: only one that offers to a Space of theirs.
				let offering = false;
				for (const space of await caller.spaces()) {
					if (await offersInto(deviceId, space)) offering = true;
				}
				if (!offering) return false;
			}
			return deps.work.online(deviceId, "");
		},
	};

	/** Whether a Device offers profiles to a Space (its document says so). */
	async function offersInto(deviceId: string, spaceId: string) {
		return (await engine.offers.list(spaceId)).some(
			(o) => o.deviceId === deviceId,
		);
	}

	/**
	 * Refuses a lease call for a Space another Host keeps (its leases are
	 * that Host's), and for a Person whose role there does not start runs.
	 */
	async function mayLease(caller: Caller, spaceId: string) {
		if ((await engine.hostSpaces.hostOf(spaceId)) !== null) {
			forbidden("Another computer keeps the leases of this Space.");
		}
		await caller.may(spaceId, STARTS_RUNS);
	}

	/** The archive takes a run's files from its Walker only, in its owner's Spaces. */
	async function ownRun(caller: Caller, ref: ArchiveRef): Promise<void> {
		const owner = await exchange.runOwner(ref.runId);
		const step =
			ref.kind === "checkpoint" ? null : await exchange.stepOwner(ref.stepId);
		if (
			!owner ||
			owner.walkerId !== caller.deviceId ||
			owner.spaceId !== ref.spaceId ||
			(ref.kind !== "checkpoint" && step?.runId !== ref.runId) ||
			!(await caller.member(owner.spaceId))
		) {
			forbidden("A device may only archive the runs it walks.");
		}
	}
}

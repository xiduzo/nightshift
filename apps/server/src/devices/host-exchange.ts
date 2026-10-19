import type { HostExchange, SyncBatch } from "@nightshift/api/context";
import { roleAllows } from "@nightshift/auth/access";
import type { DeviceKeyAccess } from "@nightshift/auth/device-keys";
import { roleIn, spacesOf } from "@nightshift/auth/spaces";
import type { Database } from "@nightshift/db";
import {
	type ArchiveRef,
	applyRunCommand,
	COMMAND_PERMISSION,
	type Device,
	type DeviceRegistry,
	isEmpty,
	MissingProjectError,
	mergeCursors,
	type SyncCursors,
	withoutPrivatePaths,
} from "@nightshift/engine";
import type { Engine } from "@nightshift/engine/types";
import { ORPCError } from "@orpc/server";

import { NOT_A_HOST } from "./host";
import { type OfferDeps, serveChecked } from "./work";
import type { WorkHub } from "./work-hub";

/**
 * This computer as the Host of run history for its paired Devices: the
 * relay's oRPC half (`sync.*`, `archive.*`). Every call names a Device by
 * its key; the Host answers it in the name of the key's Person:
 *
 * - It serves only rows of Spaces that Person is a Member of, and never a
 *   Device's own rows back to it. Its own Walker's rows are served the
 *   same way as the ones Devices pushed: its Replica keeps everything.
 * - It takes only a Device's own rows (the runs it walks), in Spaces its
 *   Person is a Member of. Anything else refuses the whole batch.
 * - A command needs the role that allows the action, checked here. A run
 *   this Host walks gets it at once; any other waits for its Walker.
 * - The archive keeps what a Walker puts for its own runs, and gives a
 *   Member what it asks of their Spaces' runs.
 * - A Walker's paths (its worktree, its transcripts and logs on disk) stay
 *   with its owner's Replicas: the Host drops them from the rows of a
 *   Device of another Person before it keeps them, and from the rows it
 *   serves to a Device whose owner is not the Walker's
 *   (`withoutPrivatePaths`).
 */

/** How long a stream with nothing new waits before it looks again. */
const STREAM_IDLE_MS = 20_000;

export function createHostExchange(deps: {
	db: Database;
	engine: Engine;
	registry: DeviceRegistry;
	/** This Host's Device id: the Walker of its own runs. */
	selfId: string;
	/** The Person who owns this Host: the owner of its own Walker's paths. */
	ownerId: string;
	isHost(): boolean;
	/** The calls of runs this Host walks, for the Devices they are placed on. */
	work: WorkHub;
	/** This Host as a Device: it serves the calls of runs a Device walks with steps here. */
	local?: Device;
	/** This Host's own Offers, for the steps of other Persons' runs it serves itself. */
	offerDeps?: OfferDeps;
}): HostExchange {
	const { db, engine, registry } = deps;
	const { exchange } = engine;

	/** The Device may use the exchange: this is a Host, and the Device has access. */
	async function admit(key: DeviceKeyAccess): Promise<void> {
		if (!deps.isHost()) throw new Error(NOT_A_HOST);
		const paired = await registry.get(key.deviceId);
		if (!paired || paired.revokedAt) {
			throw new ORPCError("UNAUTHORIZED", {
				message: "This device has no access here. Pair it again.",
			});
		}
	}

	/** The Spaces the key's Person is a Member of. */
	async function memberSpaces(key: DeviceKeyAccess): Promise<string[]> {
		return (await spacesOf(db, key.personId)).map((s) => s.id);
	}

	async function isMember(key: DeviceKeyAccess, spaceId: string) {
		return (await roleIn(db, key.personId, spaceId)) !== null;
	}

	function forbidden(message: string): never {
		throw new ORPCError("FORBIDDEN", { message });
	}

	/** The Person who owns a Walker, as this Host knows it. */
	async function ownerOf(walkerId: string): Promise<string | null> {
		if (walkerId === deps.selfId) return deps.ownerId;
		return (await registry.get(walkerId))?.ownerId ?? null;
	}

	async function batch(
		key: DeviceKeyAccess,
		cursors: SyncCursors,
	): Promise<SyncBatch> {
		await admit(key);
		const { rows, cursors: moved } = await exchange.rows.rowsAfter({
			spaces: await memberSpaces(key),
			cursors,
			except: key.deviceId,
		});
		const owners = new Map<string, string | null>();
		for (const walkerId of new Set(rows.runs.map((r) => r.walkerId))) {
			owners.set(walkerId, await ownerOf(walkerId));
		}
		return {
			rows: withoutPrivatePaths(
				rows,
				(walkerId) => owners.get(walkerId) === key.personId,
			),
			cursors: moved,
			commands: await exchange.commands.pendingFor(key.deviceId),
		};
	}

	/** Resolves when rows land, a command is kept, the time is up, or the signal aborts. */
	function change(signal: AbortSignal): Promise<void> {
		return new Promise((resolve) => {
			const done = () => {
				off();
				resolve();
			};
			const off = exchange.commands.onEnqueued(done);
			void exchange.rows.landed(signal, STREAM_IDLE_MS).then(done);
		});
	}

	return {
		pull: batch,

		async *stream(key, cursors, signal) {
			let at = cursors;
			let sentCommands = "";
			while (!signal?.aborted) {
				const cycle = new AbortController();
				const signals = signal ? [signal, cycle.signal] : [cycle.signal];
				// Listen before reading, so nothing lands unseen between the two.
				const changed = change(AbortSignal.any(signals));
				try {
					const next = await batch(key, at);
					const commands = next.commands.map((c) => c.id).join();
					if (!isEmpty(next.rows) || commands !== sentCommands) {
						at = mergeCursors(at, next.cursors);
						sentCommands = commands;
						yield next;
						continue;
					}
					await changed;
				} finally {
					cycle.abort();
				}
			}
		},

		async push(key, rows) {
			await admit(key);
			try {
				// Another Person's Device: its paths never land in this Replica.
				const kept =
					key.personId === deps.ownerId ? rows : withoutPrivatePaths(rows);
				const added = await exchange.rows.ingest(kept, {
					walker: key.deviceId,
					spaces: await memberSpaces(key),
				});
				return { events: added.length };
			} catch (error) {
				if (error instanceof MissingProjectError) {
					throw new ORPCError("CONFLICT", { message: error.message });
				}
				throw error;
			}
		},

		async command(key, input) {
			await admit(key);
			const owner = await exchange.runOwner(input.runId);
			if (!owner || !(await isMember(key, owner.spaceId))) {
				throw new Error(`Run not found: ${input.runId}`);
			}
			const role = await roleIn(db, key.personId, owner.spaceId);
			if (!role || !roleAllows(role, COMMAND_PERMISSION[input.kind])) {
				forbidden("Your role in this Space does not allow this.");
			}
			if (owner.walkerId === deps.selfId) {
				// This Host walks the run: the action is a local one.
				await applyRunCommand(
					engine.space(owner.spaceId, { personId: key.personId }),
					input,
				);
				return;
			}
			if (owner.walkerId === key.deviceId) {
				forbidden("This device runs this run. Act on it there.");
			}
			await exchange.commands.enqueue({
				...input,
				spaceId: owner.spaceId,
				walkerId: owner.walkerId,
				personId: key.personId,
			});
		},

		async commandDone(key, input) {
			await admit(key);
			await exchange.commands.done(input.id, key.deviceId, input.error);
		},

		async addClone(key, input) {
			await admit(key);
			const role = await roleIn(db, key.personId, input.spaceId);
			if (!role || !roleAllows(role, { project: ["add"] })) {
				forbidden("Your role in this Space does not allow this.");
			}
			await exchange.recordClone({ ...input, deviceId: key.deviceId });
		},

		async offer(key, input) {
			await admit(key);
			const role = await roleIn(db, key.personId, input.spaceId);
			if (!role || !roleAllows(role, { offer: ["make"] })) {
				forbidden("Your role in this Space does not allow offering profiles.");
			}
			await engine.offers.publish({
				...input,
				deviceId: key.deviceId,
				by: key.personId,
			});
		},

		async withdrawOffer(key, input) {
			await admit(key);
			// The Device's owner withdraws its own Offer, whatever their role now.
			if (!(await isMember(key, input.spaceId))) {
				throw new Error(`Space not found: ${input.spaceId}`);
			}
			await engine.offers.withdraw({
				...input,
				deviceId: key.deviceId,
				by: key.personId,
			});
		},

		async archivePut(key, ref, content) {
			await admit(key);
			await ownRun(key, ref);
			await exchange.writeArchive(ref, content);
		},

		async archiveGet(key, ref) {
			await admit(key);
			const owner = await exchange.runOwner(ref.runId);
			if (
				!owner ||
				owner.spaceId !== ref.spaceId ||
				!(await isMember(key, owner.spaceId))
			) {
				return null;
			}
			if (ref.kind !== "checkpoint") {
				const step = await exchange.stepOwner(ref.stepId);
				if (step?.runId !== ref.runId) return null;
			}
			return owner.walkerId === deps.selfId
				? exchange.ownFile(ref)
				: exchange.readArchive(ref);
		},

		async *work(key, input, signal) {
			await admit(key);
			yield* deps.work.take(
				key.deviceId,
				signal ?? new AbortController().signal,
				input.running,
			);
		},

		async workReply(key, input) {
			await admit(key);
			return { known: deps.work.reply(key.deviceId, input) };
		},

		async startRun(key, input) {
			await admit(key);
			const { spaceId, ...start } = input;
			await mayStart(key, spaceId);
			const run = await engine
				.space(spaceId, { personId: key.personId })
				.startRun({ ...start, startedBy: key.personId });
			return { runId: run.id };
		},

		async devices(key, input) {
			await admit(key);
			if (!(await isMember(key, input.spaceId))) {
				throw new Error(`Project not found: ${input.projectId}`);
			}
			return engine
				.space(input.spaceId, { personId: key.personId })
				.listDevices(input.projectId);
		},

		async *call(key, { deviceId, request }, signal) {
			await admit(key);
			// The Walker asks in the name of its run's Person: its own.
			if (request.personId !== key.personId) {
				forbidden("A device may ask only for its own Person's runs.");
			}
			await mayStart(key, request.spaceId);
			if (deviceId === deps.selfId) {
				const local = deps.local;
				if (!local) {
					yield { kind: "error", message: "This Host does not run steps." };
					return;
				}
				// Its owner's run, or another Person's through its Offers.
				yield* serveChecked(
					request,
					{
						ownerId: deps.ownerId,
						db,
						engine,
						device: local,
						...deps.offerDeps,
					},
					signal ?? new AbortController().signal,
				);
				return;
			}
			const paired = await registry.get(deviceId);
			if (
				!paired ||
				paired.revokedAt ||
				(paired.ownerId !== key.personId &&
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
			yield* deps.work.call(deviceId, request, signal);
		},

		async reachable(key, deviceId) {
			await admit(key);
			if (deviceId === deps.selfId) return true;
			const paired = await registry.get(deviceId);
			if (!paired || paired.revokedAt) return false;
			if (paired.ownerId !== key.personId) {
				// Another Person's: only one that offers to a Space of theirs.
				let offering = false;
				for (const space of await memberSpaces(key)) {
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

	/** Refuses a Person whose role in the Space does not start runs. */
	async function mayStart(key: DeviceKeyAccess, spaceId: string) {
		const role = await roleIn(db, key.personId, spaceId);
		if (!role || !roleAllows(role, { run: ["start"] })) {
			forbidden("Your role in this Space does not allow this.");
		}
	}

	/** The archive takes a run's files from its Walker only, in its owner's Spaces. */
	async function ownRun(key: DeviceKeyAccess, ref: ArchiveRef): Promise<void> {
		const owner = await exchange.runOwner(ref.runId);
		const step =
			ref.kind === "checkpoint" ? null : await exchange.stepOwner(ref.stepId);
		if (
			!owner ||
			owner.walkerId !== key.deviceId ||
			owner.spaceId !== ref.spaceId ||
			(ref.kind !== "checkpoint" && step?.runId !== ref.runId) ||
			!(await isMember(key, owner.spaceId))
		) {
			forbidden("A device may only archive the runs it walks.");
		}
	}
}

import { roleAllows } from "@nightshift/auth";
import { type SyncedDocuments, sharedAnswerCosts } from "@nightshift/engine";
import {
	createDeviceCopies,
	type DeviceCopies,
	profileChoice,
} from "@nightshift/engine/device-config";
import { memberRole, systemGitHubCli } from "@nightshift/engine/projects";
import { now } from "@nightshift/time";
import type { HostHello } from "./contract";
import type { DevicesDeps, DevicesRuntime } from "./devices-runtime";
import {
	createDeviceExchange,
	createHostExchange,
	shareAnswerCosts,
} from "./exchange";
import { letGo, takeOver } from "./handover";
import { createDevices, createHost } from "./host";
import {
	createDeviceLinks,
	createHostLinks,
	deviceKeyStore,
	type HostLink,
	type SyncedDocument,
	tellClones,
} from "./links";
import { createHomeMembership } from "./membership";
import { createOffers, deviceOffers, offeredProfile } from "./offers";
import { createPeerEngine } from "./peers";
import { listenHostname, ownCertificate, reachFor } from "./reach";
import { adoptSelfDevice, OFFLINE_AFTER_MS } from "./registry";
import { createRelay, createWorkRelay } from "./relay";
import {
	createPersonalSecretStore,
	createPersonalSecretsHost,
	createProjectSecretStore,
	createProjectSecretsHost,
	createSecretMovesHost,
	createSpaceSecretStore,
	devicePersonalSecrets,
	deviceProjectSecrets,
	deviceSecretMoves,
	secretsCipher,
	serveSecretCall,
} from "./secrets";
import { createWorkServer, servedCalls } from "./work";

/**
 * This computer among Devices: its engine with its peers, the Host it may
 * be (pairing, Device keys, presence, the exchange of run history), its
 * Offers, and its Links to the Hosts it paired with, each with the
 * exchange and the work server over it. Secure by default: the daemon
 * answers this computer only, until it is a Host with an https:// address
 * (`reach`, read at start).
 *
 * It owns its reload, as `Engine.dispose` does for runs. `bun --hot` calls
 * it again in the same process. The runtime before lets go first: its
 * Links and presence sweep stop, the commands it is applying end, and its
 * engine lets go of its runs. Then this one takes over what must outlive
 * the reload (the work hub, the applied commands, the calls served as a
 * placed Device, the Offers in use, the Devices online and the pairings
 * in progress) and binds them to its own engine.
 *
 * One start at a time: two saves in a row reload twice, and the second
 * start waits until the first one ends. Else both take over the same
 * runtime, and the one that sets its `release` first is never released:
 * its Links pull from the Host beside the next runtime's, and its
 * engine's copy of the runs takes the rows first.
 */
export function startDevices(deps: DevicesDeps): Promise<DevicesRuntime> {
	const before = deps.kept.nightshiftDevicesStart;
	const start = (before ?? Promise.resolve()).then(() => startNow(deps));
	// A start that failed ends the turn too: the next one takes over.
	deps.kept.nightshiftDevicesStart = start.then(
		() => {},
		() => {},
	);
	return start;
}

async function startNow(deps: DevicesDeps): Promise<DevicesRuntime> {
	const { db, self, ownerId, local } = deps;
	// What can fail comes first: then the runtime before keeps running.
	const reach = reachFor(deps.settings.current());
	const certificate = ownCertificate(deps.env);
	const fingerprint = certificate?.fingerprint ?? null;
	const devicesPage = new URL("/devices", deps.env.CORS_ORIGIN).toString();
	const hostLinks = createHostLinks(db);
	const keysOf = (deviceId: string) =>
		deviceKeyStore({ dataDir: deps.dataDir, deviceId, ...deps.keyStore });
	const keyStore = await keysOf(self.id);
	const localOnly = deps.dev === true && deps.devLinkHost !== true;
	const machine = deps.machine ?? null;

	const handover = await takeOver(deps.kept);

	/** Per Host: what outlives a reload. */
	function keptFor(hostId: string) {
		let kept = handover.hosts.get(hostId);
		if (!kept) {
			kept = { applied: new Map(), served: servedCalls() };
			handover.hosts.set(hostId, kept);
		}
		return kept;
	}

	/**
	 * Read-only copies of the documents of this computer's owner's other
	 * Devices, from the home Host: their names, profiles and secret names.
	 */
	const copies = createDeviceCopies({
		db,
		selfId: self.id,
		documents: deps.documents,
	});

	// The actions on rows another Device owns, carried over the Links. The
	// relays reach the engine and the Links: they read both when they are
	// called, after this function.
	const relay = createRelay({
		engine: () => engine,
		registry: () => engine.devices,
		links: () => links,
		flows: deps.flows,
	});

	const engine = createPeerEngine(
		{
			db,
			walkerId: self.id,
			device: local,
			dataDir: deps.dataDir,
			archive: deps.archive,
			settings: () => deps.settings.run(),
			profileFor: (ref) => deps.profiles.settingsFor(ref),
			spaceDocuments: deps.spaces,
			flowDocuments: deps.flows,
			// The import on upgrade gives a Clone's project profiles to this Device.
			profiles: deps.profiles,
			scheduler: deps.scheduler,
			github: systemGitHubCli(),
			...(deps.usage ? { usage: deps.usage } : {}),
			...(deps.secret ? { secret: deps.secret } : {}),
			...(deps.moveRows ? { moveRows: deps.moveRows } : {}),
			...(deps.projectsMoved ? { projectsMoved: deps.projectsMoved } : {}),
			// The hub for the Spaces this computer keeps; its Hosts for the others.
			work: createWorkRelay({
				hub: handover.hub,
				engine: () => engine,
				links: () => links,
			}),
			relay,
			// This computer's own Offers, the sessions and calls under them,
			// and who may use Offers in a Space.
			ownOffers: () =>
				deviceOffers(
					deps.document,
					(profile) => offeredProfile(deps.profiles, profile)?.name ?? null,
				),
			ownProfiles: () => deps.profiles.list().map(profileChoice),
			// Made below: asked while a run starts.
			isHost: () => host.isHost(),
			copies,
			offerUse: handover.offerUse,
			presence: handover.presence,
			mayUseOffers: async (spaceId, personId) => {
				const role = memberRole(await deps.spaces.open(spaceId), personId);
				return role !== null && roleAllows(role, { offer: ["use"] });
			},
		},
		deps.internals?.engine,
	);

	/** This computer as a Host: pairing, Device keys, presence. */
	const host = createHost({
		auth: deps.auth,
		db,
		registry: engine.devices,
		settings: deps.settings,
		self,
		devicesPage,
		fingerprint,
		disconnect: deps.disconnect,
		forgetClones: (deviceId) => engine.projects.forgetDevice(deviceId),
		pending: handover.pending,
	});

	/** This computer as the Host of run history: what paired Devices pull, push and archive. */
	const hostExchange = createHostExchange({
		db,
		engine,
		registry: engine.devices,
		selfId: self.id,
		ownerId,
		work: handover.hub,
	});

	/** This computer's Offers into Spaces, as its owner makes and withdraws them. */
	const offers = createOffers({
		db,
		engine,
		document: deps.document,
		profiles: deps.profiles,
		self: { id: self.id, name: self.name },
		ownerId,
		withdrawn: (spaceId, profile) =>
			engine.admission.withdrawn(spaceId, profile),
	});

	/** The secret calls of its Home Host: this computer moves its own value (ADR 13). */
	const secretCalls = serveSecretCall({
		hostLinks,
		own: deps.ownSecrets,
		ownerId,
	});

	/** This computer's links to the Hosts it paired with. */
	const links = createDeviceLinks({
		links: hostLinks,
		keys: keyStore,
		deviceId: self.id,
		localOnly,
		// The Spaces the Host lists: kept here as the Host's, their documents
		// synced read-only, before run rows that name their projects arrive.
		// The flow and knowledge documents of their Projects sync both ways.
		// A Project the Host adds later syncs from its next answer.
		documents: async (link, hello) => {
			const { hostSpaces } = engine;
			await hostSpaces.update(
				{ id: link.hostId, name: hello.host.name },
				hello.spaces,
				ownerId,
			);
			const kept = new Set(await hostSpaces.ofHost(link.hostId));
			return documentsWithHost(
				{ documents: deps.documents, document: deps.document, copies },
				link,
				hello,
				hello.spaces.filter((space) => kept.has(space.id)).map((s) => s.id),
			);
		},
		// Without its home Host this computer learns nothing of the others,
		// and its Personal splits off the Host's: it keeps a copy.
		revoked: async (link) => {
			await membership.revoked(link).catch(() => {
				// It waits for the runs this computer walks: `keepFinishing` tries again.
			});
		},
		// Run history both ways, the commands for the runs this computer walks,
		// and the steps of the Host's runs placed on this computer.
		attach: (hostLink, link) => {
			const { hostId } = hostLink;
			const { applied, served } = keptFor(hostId);
			const stops = [
				createDeviceExchange({
					engine,
					hostId,
					selfId: self.id,
					applied,
				}).attach(link),
				// Every call of a run passes the engine's Offer admission. A
				// secret call is its owner's, from its Home Host only.
				createWorkServer({
					serve: (request, signal) =>
						request.call.kind === "secret"
							? secretCalls(request, { hostId })
							: engine.admission.serve(request, { hostId }, signal),
					served,
					// A session for a Walker that this computer cannot reach stops.
					replyDeadlineMs: () =>
						deps.settings.current().offlineWorkMinutes * 60_000,
				}).attach(link),
				// This computer's Clones, each time the link comes online: a Clone
				// the Host missed heals, one this computer no longer has goes.
				link.stream(
					"Telling the Host of this computer's projects",
					tellClones({
						spaces: () => engine.hostSpaces.ofHost(hostId),
						projects: engine.projects,
						deviceName: async () =>
							(await engine.devices.get(self.id))?.name ?? self.name,
						dev: process.env.NIGHTSHIFT_DEV === "true",
						// A guest Host is another Person's: it never hears of this computer.
						machine: hostLink.role === "home" ? machine : null,
					}),
				),
				// What the answers of Night Shift's own agents cost, both ways, for
				// the Spaces this Host keeps.
				link.stream(
					"Sharing what Night Shift's agents cost",
					shareAnswerCosts({
						spaces: () => engine.hostSpaces.ofHost(hostId),
						costs: sharedAnswerCosts(db),
						now,
					}),
				),
				// The leases of the runs here, each time the link comes online:
				// the renewal at the start did not reach a Host whose link was not
				// up yet. Once per online period. The link does not wait for it,
				// and a renewal that fails waits for the next minute's.
				link.stream(
					"Renewing the leases of this computer's runs",
					async (_client, signal) => {
						engine.hostBack().catch((error) => {
							console.warn(
								`The leases were not renewed when the link to ${hostLink.name} came online:`,
								error,
							);
						});
						await new Promise<void>((resolve) => {
							if (signal.aborted) resolve();
							else
								signal.addEventListener("abort", () => resolve(), {
									once: true,
								});
						});
					},
				),
			];
			return () => {
				for (const stop of stops) stop();
			};
		},
		...(deps.hostClient ? { hostClient: deps.hostClient } : {}),
		...(deps.documentChannel ? { documentChannel: deps.documentChannel } : {}),
		...(deps.internals?.links ? { linkOptions: deps.internals.links } : {}),
	});

	/**
	 * This computer's membership of its home Host (ADR 1): the merge of its
	 * Personal into the Host's, and the split when it leaves.
	 */
	const membership = createHomeMembership({
		db,
		engine,
		links,
		hostLinks,
		keys: keyStore,
		copies,
		spaces: deps.spaces,
		flows: deps.flows,
		self,
		ownerId,
		dataDir: deps.dataDir,
	});
	// A merge that moved its rows finishes when its Host answers. A split
	// starts once this computer left its Host, and finishes by itself.
	const finishing = new AbortController();
	membership.keepFinishing(finishing.signal);

	const presence = setInterval(() => {
		engine.devices.sweep(OFFLINE_AFTER_MS).catch((error) => {
			console.error("Device presence was not updated:", error);
		});
	}, deps.internals?.presenceMs ?? 5_000);
	presence.unref();

	// From here the next runtime takes over from this one.
	handover.wake = (deviceId) => {
		engine.deviceBack(deviceId).catch((error) => {
			console.error("Steps that waited for a device were not woken:", error);
		});
	};
	handover.release = async () => {
		finishing.abort();
		clearInterval(presence);
		await links.close();
		// A command this engine is applying ends here: the next runtime
		// reports its result, and does not apply it again.
		await Promise.allSettled(
			[...handover.hosts.values()].flatMap(({ applied }) => [
				...applied.values(),
			]),
		);
		await letGo(engine);
	};
	deps.kept.nightshiftDevices = handover;

	await links.start();

	/** The Personal secrets this computer keeps: as a Home Host, and its owner's without one. */
	const cipher = secretsCipher(deps.secretsKey);
	const personalStore = createPersonalSecretStore({ db, cipher });
	/** The Project secrets this computer keeps: of the Spaces it keeps, as their Host or without one. */
	const projectStore = createProjectSecretStore({ db, cipher });
	/** The Space secrets this computer keeps: of the Spaces it keeps, as their Host or without one. */
	const spaceStore = createSpaceSecretStore({ db, cipher });
	const projectSecrets = deviceProjectSecrets({
		db,
		hostSpaces: engine.hostSpaces,
		links: () => links,
		store: projectStore,
		spaceStore,
		ownerId,
	});
	const personalSecrets = devicePersonalSecrets({
		hostLinks,
		links: () => links,
		store: personalStore,
		ownerId,
		selfId: self.id,
	});

	const devices = createDevices({
		host,
		links,
		hostLinks,
		personalSecrets: createPersonalSecretsHost({ store: personalStore }),
		projectSecrets: createProjectSecretsHost({
			db,
			store: projectStore,
			spaceStore,
			hostOf: (spaceId) => engine.hostSpaces.hostOf(spaceId),
			// The calls this Host sends to its placed Devices.
			work: handover.hub,
			offersInto: async (deviceId, spaceId) =>
				(await engine.offers.list(spaceId)).some(
					(offer) => offer.deviceId === deviceId,
				),
		}),
		// As a Home Host: a paired Device asks to move a secret on another.
		secretMoves: createSecretMovesHost({
			registry: engine.devices,
			work: handover.hub,
			self: { id: self.id, ownerId, own: deps.ownSecrets },
		}),
		// The owner's moves of a secret on another of their Devices.
		moves: deviceSecretMoves({
			registry: engine.devices,
			work: handover.hub,
			hostLinks,
			links: () => links,
			ownerId,
		}),
		hostSpaces: engine.hostSpaces,
		keys: keyStore,
		identity: {
			machine,
			keysOf,
			adopt: (deviceId, walkerSeq) => adoptSelfDevice(db, deviceId, walkerSeq),
		},
		localOnly,
		settings: deps.settings,
		self: { id: self.id, name: self.name, platform: process.platform },
		reach,
		fingerprint,
		copies,
		keptDocument: (deviceId) => engine.keptDevice(deviceId),
		membership,
	});

	return {
		engine,
		host,
		devices,
		hostExchange,
		offers,
		reach,
		inStep: relay.inStep,
		personalSecrets,
		projectSecrets,
		serve: {
			hostname: listenHostname(reach, deps.env.NIGHTSHIFT_LISTEN),
			...(certificate
				? { tls: { cert: certificate.cert, key: certificate.key } }
				: {}),
		},
	};
}

/**
 * What a Device syncs with a Host. Over a link to its home Host: its own
 * Device document, and a read-only copy of each of its owner's other
 * Devices' documents that the Host lists (`DeviceCopies.keep`). Over any
 * link: the documents of each Space the Host keeps for it, which it
 * only receives, with the flow documents (ADR 2) and the knowledge
 * document (ADR 4) of each Project in it, which it keeps a copy of and
 * changes too (`SyncedDocuments.ofSpace`).
 */
export async function documentsWithHost(
	from: {
		documents: Pick<SyncedDocuments, "ofSpace">;
		document: SyncedDocument;
		copies: Pick<DeviceCopies, "keep">;
	},
	link: Pick<HostLink, "role">,
	hello: Pick<HostHello, "devices">,
	spaceIds: readonly string[],
): Promise<SyncedDocument[]> {
	const synced: SyncedDocument[] = [];
	if (link.role === "home") {
		synced.push({ name: from.document.name, doc: from.document.doc });
		synced.push(...(await from.copies.keep(hello.devices ?? [])));
	}
	for (const spaceId of spaceIds) {
		for (const document of await from.documents.ofSpace(spaceId)) {
			synced.push({ name: document.name, doc: document.doc });
		}
	}
	return synced;
}

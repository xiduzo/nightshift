import { systemGitHubCli } from "@nightshift/engine";
import { profileChoice, wireCopies } from "@nightshift/engine/settings";
import { OFFLINE_AFTER_MS } from "./contract";
import { wireMembership } from "./devices";
import type { DevicesDeps, DevicesRuntime } from "./devices-runtime";
import { letGo, takeOver } from "./handover";
import { createHostLinks, deviceKeyStore } from "./links";
import { listenHostname, ownCertificate, reachFor } from "./reach";
import { createRelay, createWorkRelay } from "./relay";
import { wireDevices, wireHost, wireHostExchange } from "./wire-host";
import { wireLinks } from "./wire-links";
import { engineOffersOf, wireOffers } from "./wire-offers";
import { createPeerEngine } from "./wire-peers-engine";
import { wireSecretCalls, wireSecrets } from "./wire-secrets";
import { servedCalls } from "./work";

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
	const { db, self, local } = deps;
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
	const copies = wireCopies({ db, documents: deps.documents }).forDevice(
		self.id,
	);

	// The actions on rows another Device owns, carried over the Links. The
	// relays reach the engine and the Links: they read both when they are
	// called, after this function.
	const relay = createRelay({
		engine: () => engine,
		registry: () => engine.devices,
		links: () => links,
		flows: deps.flows,
	});

	const { ownOffers, mayUseOffers } = engineOffersOf(deps);
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
			ownOffers,
			ownProfiles: () => deps.profiles.list().map(profileChoice),
			// Made below: asked while a run starts.
			isHost: () => host.isHost(),
			copies,
			offerUse: handover.offerUse,
			presence: handover.presence,
			mayUseOffers,
		},
		deps.internals?.engine,
	);

	const host = wireHost(deps, engine, { devicesPage, fingerprint, handover });
	const hostExchange = wireHostExchange(deps, engine, handover);
	const offers = wireOffers(deps, engine);
	const secretCalls = wireSecretCalls(deps, hostLinks);
	const links = wireLinks(deps, engine, {
		hostLinks,
		keys: keyStore,
		localOnly,
		machine,
		copies,
		keptFor,
		secretCalls,
		membership: () => membership,
	});
	const { membership, finishing } = wireMembership(deps, engine, {
		links,
		hostLinks,
		keys: keyStore,
		copies,
	});

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

	const secrets = wireSecrets(deps, engine, {
		hostLinks,
		links: () => links,
		handover,
	});
	const devices = wireDevices(deps, engine, {
		host,
		links,
		hostLinks,
		secrets: secrets.ofDevices,
		keys: keyStore,
		machine,
		keysOf,
		localOnly,
		reach,
		fingerprint,
		copies,
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
		personalSecrets: secrets.personalSecrets,
		projectSecrets: secrets.projectSecrets,
		serve: {
			hostname: listenHostname(reach, deps.env.NIGHTSHIFT_LISTEN),
			...(certificate
				? { tls: { cert: certificate.cert, key: certificate.key } }
				: {}),
		},
	};
}

import type { SyncedDocuments } from "@nightshift/engine";
import type { DeviceCopies } from "@nightshift/engine/device-config";
import { now } from "@nightshift/time";
import type { HostHello } from "./contract";
import type { DevicesDeps } from "./devices-runtime";
import { createDeviceExchange, shareAnswerCosts } from "./exchange";
import type { Handover } from "./handover";
import {
	createDeviceLinks,
	type DeviceKeyStore,
	type DeviceLinks,
	type HostLink,
	type HostLinks,
	type SyncedDocument,
	tellClones,
} from "./links";
import type { HomeMembership } from "./membership";
import type { PeerEngine } from "./wire-peers-engine";
import type { wireSecretCalls } from "./wire-secrets";
import { createWorkServer } from "./work";

/**
 * The Links block of the devices runtime (`startDevices`): this
 * computer's links to the Hosts it paired with, and what each link
 * carries.
 */

/** Per Host: what outlives a reload (`Handover.hosts`). */
type KeptForHost = Handover["hosts"] extends Map<string, infer K> ? K : never;

/** This computer's links to the Hosts it paired with. */
export function wireLinks(
	deps: Pick<
		DevicesDeps,
		| "documents"
		| "document"
		| "settings"
		| "self"
		| "ownerId"
		| "hostClient"
		| "documentChannel"
		| "internals"
	>,
	engine: PeerEngine,
	at: {
		hostLinks: HostLinks;
		keys: DeviceKeyStore;
		localOnly: boolean;
		machine: string | null;
		copies: DeviceCopies;
		keptFor(hostId: string): KeptForHost;
		secretCalls: ReturnType<typeof wireSecretCalls>;
		/** Made after the links: read when a Host removes this computer's access. */
		membership(): HomeMembership;
	},
): DeviceLinks {
	const { self, ownerId } = deps;
	const { copies, keptFor, secretCalls, machine } = at;
	return createDeviceLinks({
		links: at.hostLinks,
		keys: at.keys,
		deviceId: self.id,
		localOnly: at.localOnly,
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
			await at
				.membership()
				.revoked(link)
				.catch(() => {
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
						costs: engine.answerCosts,
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

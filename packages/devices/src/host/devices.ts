import {
	type DeviceCopies,
	type DeviceCopy,
	HostUnreachableError,
	type SettingsStore,
} from "@nightshift/engine";
import type { HostClient, PhoneView } from "../contract";
import {
	type DeviceKeyStore,
	type DeviceLinks,
	fromHost,
	type HostLinks,
	type HostSpaces,
	joinHost,
} from "../links";
import { mergeOnJoin, type PersonalSpaceMerge } from "../merge";
import { type Reach, reachFor } from "../reach";
import type { Host } from "./host";
import type { Devices, DevicesOverview, OtherDeviceView } from "./types";

/** How long the phones a Host listed stay as they are, in milliseconds. */
const PHONES_FOR_MS = 30_000;

/** The API's `Devices`: this computer as a Host, and its own links to Hosts. */
export function createDevices(deps: {
	host: Host;
	links: DeviceLinks;
	hostLinks: HostLinks;
	/** The Spaces this computer takes part in through each Host. */
	hostSpaces: Pick<HostSpaces, "listed" | "hostOf">;
	keys: DeviceKeyStore;
	settings: SettingsStore;
	self: { id: string; name: string; platform: string };
	/** Whom this daemon answers since it started. */
	reach: Reach;
	/** The SHA-256 fingerprint of the certificate this daemon serves itself. */
	fingerprint: string | null;
	/** The copies of the owner's other Devices' documents, from the home Host. */
	copies: Pick<DeviceCopies, "list">;
	/** On a Host: the Device document it keeps for a paired Device, read. */
	keptDocument(deviceId: string): Promise<DeviceCopy | null>;
	/** The merge of this computer's Personal into its home Host's. */
	merge: Pick<PersonalSpaceMerge, "preview" | "run" | "pending">;
	/** The clock, in milliseconds. Default: `Date.now`. */
	now?: () => number;
}): Devices {
	const { host } = deps;
	const now = deps.now ?? Date.now;
	/**
	 * The phones on each Host, as it last said: the Devices page asks every
	 * few seconds, and a phone signs in rarely. Signing one out here asks
	 * again.
	 */
	const phones = new Map<string, { at: number; list: Promise<PhoneView[]> }>();
	/**
	 * One call for a person on a Host this computer joined. Its link is not
	 * running: unreachable. The Host's errors come back in this computer's
	 * words (`fromHost`).
	 */
	async function onHost<T>(
		hostId: string,
		use: (client: HostClient) => Promise<T>,
	): Promise<T> {
		const link = deps.links.get(hostId);
		if (!link) throw new HostUnreachableError();
		try {
			return await link.call(use);
		} catch (error) {
			throw fromHost(error);
		}
	}
	return {
		async overview({ personId, owner }): Promise<DevicesOverview> {
			const settings = deps.settings.current();
			return {
				thisComputer: owner
					? {
							...deps.self,
							keyStore: deps.keys.kind,
							host: {
								enabled: settings.host,
								addresses: settings.hostAddresses,
								reachable: deps.reach,
								restartNeeded: reachFor(settings) !== deps.reach,
								fingerprint: deps.fingerprint,
							},
							hosts: await Promise.all(
								(await deps.links.hosts()).map(async (linked) => ({
									...linked,
									spaces: await deps.hostSpaces.listed(linked.hostId),
								})),
							),
						}
					: null,
				devices: await host.registry.list(personId),
			};
		},
		startPairing: (input) => host.startPairing(input),
		redeemPairing: (input) => host.redeemPairing(input),
		review: (headers, code, personId) => host.review(headers, code, personId),
		approve: (headers, code) => host.approve(headers, code),
		deny: (headers, code) => host.deny(headers, code),
		revoke: (personId, deviceId) => host.revoke(personId, deviceId),
		hello: (key) => host.hello(key),
		async others(ownerId) {
			const view = (
				copy: DeviceCopy,
				name: string,
				online: boolean | null,
			): OtherDeviceView => {
				const { deviceId, name: _reported, ...rest } = copy;
				return { ...rest, id: deviceId, name, online };
			};
			const listed: OtherDeviceView[] = [];
			const seen = new Set([deps.self.id]);
			// On a Host: the owner's Devices whose home it is.
			for (const paired of await host.registry.list(ownerId)) {
				if (paired.revokedAt !== null || paired.homeHost === null) continue;
				const kept = await deps.keptDocument(paired.id);
				if (!kept) continue;
				seen.add(paired.id);
				listed.push(view(kept, paired.name, paired.online));
			}
			// On a Device: the copies its home Host syncs.
			for (const copy of await deps.copies.list()) {
				if (seen.has(copy.deviceId)) continue;
				listed.push(view(copy, copy.name ?? "Device", null));
			}
			return listed.sort(
				(a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
			);
		},
		hostOf: (spaceId) => deps.hostSpaces.hostOf(spaceId),
		phonesAt(hostId) {
			const known = phones.get(hostId);
			if (known && now() - known.at < PHONES_FOR_MS) return known.list;
			const list = onHost(hostId, (client) => client.link.phones());
			phones.set(hostId, { at: now(), list });
			// A Host that did not answer is asked again next time.
			list.catch(() => {
				if (phones.get(hostId)?.list === list) phones.delete(hostId);
			});
			return list;
		},
		async removePhoneAt(hostId, phoneId) {
			try {
				return await onHost(hostId, (client) =>
					client.link.removePhone({ id: phoneId }),
				);
			} finally {
				phones.delete(hostId);
			}
		},
		async *join(input, signal) {
			for await (const step of joinHost(
				{
					self: deps.self,
					links: deps.hostLinks,
					keys: deps.keys,
					started: (link, key) => deps.links.add(link, key),
				},
				input,
				signal,
			)) {
				yield step;
				// Merge on join: Personal becomes one with the home Host's.
				if (step.kind === "joined" && step.role === "home") {
					yield* mergeOnJoin(
						{
							merge: deps.merge,
							links: deps.links,
							hostSpaces: deps.hostSpaces,
						},
						step.hostId,
						signal,
					);
				}
			}
		},
		mergePending: () => deps.merge.pending(),
		mergePreview: (input) => deps.merge.preview(input),
		merge: (input) => deps.merge.run(input),
	};
}

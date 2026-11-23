import type { Role } from "@nightshift/auth";
import { roleAllows } from "@nightshift/auth";
import type { RunSummary } from "@nightshift/engine";
import type { OfferCaps } from "../../../../contract";
import type {
	HostSpaces,
	Memberships,
	OfferAbort,
	Profiles,
	Registry,
	SpaceOffers,
	SpaceReads,
} from "../../application/ports";
import type { SpaceOffer } from "../../domain/offers";
import { inMemoryDeviceOffers } from "./in-memory-device-offers";

type Profile = { id: string; name: string; agent: boolean };

/**
 * The in-memory twins of the ports another slice fills. One file holds
 * them. Use-case tests start from `inMemoryOfferNeighbours`.
 */
export function inMemoryOfferNeighbours() {
	const deviceOffers = inMemoryDeviceOffers();
	const profiles = new Map<string, Profile>();
	const spaces: {
		id: string;
		name: string;
		personal: boolean;
		role: Role;
	}[] = [];
	const names = new Map<string, string>();
	const personals = new Map<string, string>();
	const hosts = new Map<string, string | null>();
	const home: string[] = [];
	const paired = new Map<
		string,
		{
			id: string;
			ownerId: string;
			platform: string | null;
			lastSeenAt: number | null;
			revokedAt: number | null;
			online: boolean;
		}
	>();
	const listed = new Map<string, SpaceOffer[]>();
	const published: (OfferCaps & {
		spaceId: string;
		profile: string;
		profileName: string;
		deviceId: string;
		deviceName: string;
		by: string | null;
	})[] = [];
	const withdrawn: {
		spaceId: string;
		profile: string;
		deviceId: string;
		by: string | null;
	}[] = [];
	const aborted: { spaceId: string; profile: string }[] = [];
	const runs = new Map<
		string,
		{
			id: string;
			title: string;
			status: RunSummary["status"];
			device: { id: string };
			startedBy: { id: string; name: string | null } | null;
			createdAt: number;
		}[]
	>();
	const projects = new Map<
		string,
		{
			id: string;
			name: string;
			clones: {
				deviceId: string;
				deviceName: string | null;
				thisDevice: boolean;
			}[];
		}[]
	>();
	const memberNames = new Map<string, string>();
	let clock = 1_000;
	const order: string[] = [];

	const spaceOffers: SpaceOffers = {
		async list(spaceId) {
			return listed.get(spaceId) ?? [];
		},
		async publish(offer) {
			order.push("publish");
			published.push(offer);
		},
		async withdraw(input) {
			order.push("withdraw");
			withdrawn.push(input);
		},
	};
	const memberships: Memberships = {
		async spacesOf() {
			return spaces;
		},
		roleAllows,
		async personNames(ids) {
			return new Map(
				ids.flatMap((id) => {
					const name = names.get(id);
					return name ? [[id, name] as const] : [];
				}),
			);
		},
		async personalSpaceIdBySlug(personId) {
			return personals.get(personId) ?? null;
		},
		async personInSpace(_spaceId, personId) {
			return personId;
		},
	};
	const profilePort: Profiles = {
		get(id) {
			const found = profiles.get(id);
			return found ? { id: found.id, name: found.name } : null;
		},
		byName(name) {
			const found = [...profiles.values()].find((p) => p.name === name);
			return found ? { id: found.id, name: found.name } : null;
		},
		agent(id) {
			const found = profiles.get(id);
			if (!found?.agent) return null;
			return { id: found.id, name: found.name };
		},
	};
	const registry: Registry = {
		async get(id) {
			return paired.get(id) ?? null;
		},
		async homePersons() {
			return home;
		},
	};
	const hostSpaces: HostSpaces = {
		async hostOf(spaceId) {
			return hosts.get(spaceId) ?? null;
		},
	};
	const spaceReads: SpaceReads = {
		async listRuns(spaceId) {
			return runs.get(spaceId) ?? [];
		},
		async listProjects(spaceId) {
			return projects.get(spaceId) ?? [];
		},
		async memberName(spaceId, personId) {
			return memberNames.get(`${spaceId}/${personId}`) ?? null;
		},
	};
	const abort: OfferAbort = {
		withdrawn(spaceId, profile) {
			order.push("abort");
			aborted.push({ spaceId, profile });
		},
	};

	return {
		deviceOffers,
		spaceOffers,
		memberships,
		profiles: profilePort,
		registry,
		hostSpaces,
		spaceReads,
		abort,
		self: { id: "self", name: "This computer" },
		ownerId: "ada",
		now: () => clock,
		published,
		withdrawn,
		aborted,
		order,
		addProfile(profile: Profile) {
			profiles.set(profile.id, profile);
		},
		addSpace(space: (typeof spaces)[number]) {
			spaces.push(space);
		},
		setListed(spaceId: string, offers: SpaceOffer[]) {
			listed.set(spaceId, offers);
		},
		setRuns(spaceId: string, rows: NonNullable<ReturnType<typeof runs.get>>) {
			runs.set(spaceId, rows);
		},
		setProjects(
			spaceId: string,
			rows: NonNullable<ReturnType<typeof projects.get>>,
		) {
			projects.set(spaceId, rows);
		},
		setMemberName(spaceId: string, personId: string, name: string) {
			memberNames.set(`${spaceId}/${personId}`, name);
		},
		setHome(persons: string[]) {
			home.splice(0, home.length, ...persons);
		},
		setPersonal(personId: string, spaceId: string) {
			personals.set(personId, spaceId);
		},
		setName(personId: string, name: string) {
			names.set(personId, name);
		},
		setHost(spaceId: string, hostId: string | null) {
			hosts.set(spaceId, hostId);
		},
		setPaired(device: {
			id: string;
			ownerId: string;
			platform: string | null;
			lastSeenAt: number | null;
			revokedAt: number | null;
			online: boolean;
		}) {
			paired.set(device.id, device);
		},
		setClock(value: number) {
			clock = value;
		},
	};
}

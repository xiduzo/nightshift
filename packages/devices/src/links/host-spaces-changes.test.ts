import { describe, expect, test } from "bun:test";
import type { ListedSpace } from "../contract";
import {
	type HostSpaceChange,
	type HostSpaceState,
	hostSpaceChanges,
	type KeptHostSpace,
} from "./host-spaces-changes";

const studio = { id: "host-a", name: "studio" };

const team: ListedSpace = {
	id: "space-team",
	name: "Team",
	personal: false,
	role: "member",
};
const theirs: ListedSpace = {
	id: "space-personal-a",
	name: "Ada",
	personal: true,
	role: "owner",
};

const keptTeam: Row = {
	spaceId: "space-team",
	hostId: studio.id,
	name: "Team",
	role: "member",
	personal: false,
};

/** A kept row, still kept unless it says it was left. */
type Row = Omit<KeptHostSpace, "left"> & { left?: boolean };

type World = Partial<Omit<HostSpaceState, "kept">> & { kept?: Row[] };

const state = ({ kept = [], ...over }: World): HostSpaceState => ({
	host: studio,
	listed: [],
	own: new Set(),
	memberships: new Map(),
	ownPersonal: null,
	...over,
	kept: kept.map((row) => ({ left: false, ...row })),
});

const take = (
	space: Omit<KeptHostSpace, "hostId" | "left">,
	membership: Extract<HostSpaceChange, { kind: "take" }>["membership"],
): HostSpaceChange => ({
	kind: "take",
	space: { ...space, hostId: studio.id, left: false },
	membership,
});

describe("what a Host's list of Spaces changes here", () => {
	test.each<[string, World, HostSpaceChange[]]>([
		[
			"a new shared Space, with no row here: kept with its name, and a membership in its role",
			{ listed: [team] },
			[
				take(
					{
						spaceId: "space-team",
						name: "Team",
						role: "member",
						personal: false,
					},
					{ kind: "add", role: "member" },
				),
			],
		],
		[
			"a Space of this Replica's own: never taken",
			{ listed: [team], own: new Set(["space-team"]) },
			[],
		],
		[
			"a Space of this Replica's own that this Host keeps: taken",
			{
				listed: [{ ...team, name: "Platform" }],
				own: new Set(["space-team"]),
				kept: [keptTeam],
				memberships: new Map([["space-team", { id: "m-1", role: "member" }]]),
			},
			[
				take(
					{
						spaceId: "space-team",
						name: "Platform",
						role: "member",
						personal: false,
					},
					null,
				),
			],
		],
		[
			"a Space another Host keeps: left as that Host lists it",
			{
				listed: [{ ...team, name: "Taken", role: "owner" }],
				own: new Set(["space-team"]),
				kept: [{ ...keptTeam, hostId: "host-b" }],
				memberships: new Map([["space-team", { id: "m-1", role: "member" }]]),
			},
			[],
		],
		[
			"a personal Space not this computer's: named after its Host",
			{ listed: [theirs] },
			[
				take(
					{
						spaceId: "space-personal-a",
						name: "Personal on studio",
						role: "owner",
						personal: true,
					},
					{ kind: "add", role: "owner" },
				),
			],
		],
		[
			"this computer's personal Space, kept by its Host: named as its own",
			{
				listed: [theirs],
				own: new Set(["space-personal-a"]),
				kept: [
					{
						spaceId: "space-personal-a",
						hostId: studio.id,
						name: "Personal on studio",
						role: "owner",
						personal: true,
					},
				],
				memberships: new Map([
					["space-personal-a", { id: "m-1", role: "owner" }],
				]),
				ownPersonal: "space-personal-a",
			},
			[
				take(
					{
						spaceId: "space-personal-a",
						name: "Personal",
						role: "owner",
						personal: true,
					},
					null,
				),
			],
		],
		[
			"a shared Space keeps the Host's name, also as this computer's personal Space",
			{ listed: [team], ownPersonal: "space-team", kept: [keptTeam] },
			[
				take(
					{
						spaceId: "space-team",
						name: "Team",
						role: "member",
						personal: false,
					},
					{ kind: "add", role: "member" },
				),
			],
		],
		[
			"renamed on the Host: the copy takes the name, the membership stays",
			{
				listed: [{ ...team, name: "Platform" }],
				own: new Set(["space-team"]),
				kept: [keptTeam],
				memberships: new Map([["space-team", { id: "m-1", role: "member" }]]),
			},
			[
				take(
					{
						spaceId: "space-team",
						name: "Platform",
						role: "member",
						personal: false,
					},
					null,
				),
			],
		],
		[
			"made personal on the Host: the copy takes it",
			{
				listed: [{ ...team, personal: true }],
				own: new Set(["space-team"]),
				kept: [keptTeam],
				memberships: new Map([["space-team", { id: "m-1", role: "member" }]]),
			},
			[
				take(
					{
						spaceId: "space-team",
						name: "Personal on studio",
						role: "member",
						personal: true,
					},
					null,
				),
			],
		],
		[
			"no longer personal on the Host, under the same name: the copy takes it",
			{
				listed: [{ ...team, name: "Personal on studio" }],
				own: new Set(["space-team"]),
				kept: [{ ...keptTeam, name: "Personal on studio", personal: true }],
				memberships: new Map([["space-team", { id: "m-1", role: "member" }]]),
			},
			[
				take(
					{
						spaceId: "space-team",
						name: "Personal on studio",
						role: "member",
						personal: false,
					},
					null,
				),
			],
		],
		[
			"a new role on the Host: the copy and the membership take it",
			{
				listed: [{ ...team, role: "admin" }],
				own: new Set(["space-team"]),
				kept: [keptTeam],
				memberships: new Map([["space-team", { id: "m-1", role: "member" }]]),
			},
			[
				take(
					{
						spaceId: "space-team",
						name: "Team",
						role: "admin",
						personal: false,
					},
					{ kind: "role", membershipId: "m-1", role: "admin" },
				),
			],
		],
		[
			"only the membership has another role: it takes the Host's",
			{
				listed: [team],
				own: new Set(["space-team"]),
				kept: [keptTeam],
				memberships: new Map([["space-team", { id: "m-1", role: "viewer" }]]),
			},
			[
				take(
					{
						spaceId: "space-team",
						name: "Team",
						role: "member",
						personal: false,
					},
					{ kind: "role", membershipId: "m-1", role: "member" },
				),
			],
		],
		[
			"only the copy has another role: it takes the Host's",
			{
				listed: [team],
				own: new Set(["space-team"]),
				kept: [{ ...keptTeam, role: "viewer" }],
				memberships: new Map([["space-team", { id: "m-1", role: "member" }]]),
			},
			[
				take(
					{
						spaceId: "space-team",
						name: "Team",
						role: "member",
						personal: false,
					},
					null,
				),
			],
		],
		[
			"the membership is gone here: it comes back",
			{
				listed: [team],
				own: new Set(["space-team"]),
				kept: [keptTeam],
			},
			[
				take(
					{
						spaceId: "space-team",
						name: "Team",
						role: "member",
						personal: false,
					},
					{ kind: "add", role: "member" },
				),
			],
		],
		[
			"left, listed again by its Host: it comes back with a membership",
			{
				listed: [team],
				own: new Set(["space-team"]),
				kept: [{ ...keptTeam, left: true }],
			},
			[
				take(
					{
						spaceId: "space-team",
						name: "Team",
						role: "member",
						personal: false,
					},
					{ kind: "add", role: "member" },
				),
			],
		],
		[
			"left, listed again by its Host with the membership still here: it comes back",
			{
				listed: [team],
				own: new Set(["space-team"]),
				kept: [{ ...keptTeam, left: true }],
				memberships: new Map([["space-team", { id: "m-1", role: "member" }]]),
			},
			[
				take(
					{
						spaceId: "space-team",
						name: "Team",
						role: "member",
						personal: false,
					},
					null,
				),
			],
		],
		[
			"left through another Host: never taken",
			{
				listed: [team],
				own: new Set(["space-team"]),
				kept: [{ ...keptTeam, hostId: "host-b", left: true }],
			},
			[],
		],
		[
			"a left Space the Host still does not list: no change",
			{ listed: [], kept: [{ ...keptTeam, left: true }] },
			[],
		],
		[
			"listed as before: nothing changes",
			{
				listed: [team],
				own: new Set(["space-team"]),
				kept: [keptTeam],
				memberships: new Map([["space-team", { id: "m-1", role: "member" }]]),
			},
			[],
		],
		[
			"a Space of this Host it no longer lists: the membership ends",
			{
				listed: [],
				kept: [
					keptTeam,
					{ ...keptTeam, spaceId: "space-other", hostId: "host-b" },
				],
			},
			[{ kind: "leave", spaceIds: ["space-team"] }],
		],
		[
			"an empty list ends every Space of this Host, and no other",
			{
				listed: [],
				kept: [
					keptTeam,
					{ ...keptTeam, spaceId: "space-b", hostId: "host-b" },
					{ ...keptTeam, spaceId: "space-mine", personal: true },
				],
			},
			[{ kind: "leave", spaceIds: ["space-team", "space-mine"] }],
		],
		[
			"an empty list of a Host that keeps nothing here: no change",
			{ listed: [], kept: [{ ...keptTeam, hostId: "host-b" }] },
			[],
		],
		[
			"the changes keep the Host's order, and the end comes last",
			{
				listed: [theirs, team],
				kept: [{ ...keptTeam, spaceId: "space-old" }],
			},
			[
				take(
					{
						spaceId: "space-personal-a",
						name: "Personal on studio",
						role: "owner",
						personal: true,
					},
					{ kind: "add", role: "owner" },
				),
				take(
					{
						spaceId: "space-team",
						name: "Team",
						role: "member",
						personal: false,
					},
					{ kind: "add", role: "member" },
				),
				{ kind: "leave", spaceIds: ["space-old"] },
			],
		],
		[
			"a Space listed twice: the second listing reads what the first one changed",
			{ listed: [team, team, { ...team, role: "admin" }] },
			[
				take(
					{
						spaceId: "space-team",
						name: "Team",
						role: "member",
						personal: false,
					},
					{ kind: "add", role: "member" },
				),
				take(
					{
						spaceId: "space-team",
						name: "Team",
						role: "admin",
						personal: false,
					},
					{ kind: "role", membershipId: null, role: "admin" },
				),
			],
		],
	])("%s", (_, over, changes) => {
		expect(hostSpaceChanges(state(over))).toEqual(changes);
	});
});

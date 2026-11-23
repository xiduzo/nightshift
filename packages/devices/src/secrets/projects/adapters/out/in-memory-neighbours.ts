import type { Role } from "@nightshift/auth";
import type { Caller } from "../../../../contract";
import { inMemoryHostCalls } from "../../../calls/adapters/out/in-memory-host-calls";
import { inMemoryProjectSecretStore } from "../../../kept/adapters/out/in-memory-project-secret-store";
import { inMemorySpaceSecretStore } from "../../../kept/adapters/out/in-memory-space-secret-store";
import type {
	EnginePlaces,
	KeeperSpaces,
	Members,
	PlacedSteps,
	RoleRules,
	SpaceOffers,
} from "../../application/ports";

/**
 * The in-memory adapters of the ports that another vertical or package
 * fills (`@filledBy` in `application/ports.ts`), and
 * `inMemoryProjectsPorts`, which gives a use-case test every port at once.
 * Test code: production code never imports this file.
 */

/** The Projects and runs the engine of a test knows. */
export function inMemoryEnginePlaces() {
	const projects = new Map<string, string>();
	const runs = new Map<
		string,
		{ walkerId: string; spaceId: string; projectId: string }
	>();
	const twin = {
		projects,
		runs,
		async spaceOf(projectId: string) {
			return projects.get(projectId) ?? null;
		},
		async runPlace(runId: string) {
			return runs.get(runId) ?? null;
		},
	};
	return twin satisfies EnginePlaces;
}

/** The Spaces that other Hosts keep in a test: every other Space is kept here. */
export function inMemoryKeeperSpaces() {
	const hosts = new Map<string, string>();
	const asked: string[] = [];
	const twin = {
		hosts,
		asked,
		async hostOf(spaceId: string) {
			asked.push(spaceId);
			return hosts.get(spaceId) ?? null;
		},
	};
	return twin satisfies KeeperSpaces;
}

/** The Members of a test's Spaces, and the names of its Persons. */
export function inMemoryMembers() {
	const roles = new Map<string, Role>();
	const names = new Map<string, string>();
	const twin = {
		roles,
		personNames: names,
		/** Gives the Person a role in the Space. */
		join(personId: string, spaceId: string, role: Role) {
			roles.set(`${personId} ${spaceId}`, role);
		},
		async roleIn(personId: string, spaceId: string) {
			return roles.get(`${personId} ${spaceId}`) ?? null;
		},
		async names(personIds: readonly string[]) {
			return new Map(
				personIds.flatMap((id) => {
					const name = names.get(id);
					return name === undefined ? [] : [[id, name] as const];
				}),
			);
		},
	};
	return twin satisfies Members;
}

/** The role rules of a test: a viewer does not save Flows. */
export function inMemoryRoleRules() {
	const twin = {
		savesFlows: (role: Role) => role !== "viewer",
		refusalWords: () => "Your role in this Space does not allow this.",
	};
	return twin satisfies RoleRules;
}

/** The steps a test's work hub has out to each Device: `deviceId runId`. */
export function inMemoryPlacedSteps() {
	const placedRuns = new Set<string>();
	const twin = {
		placedRuns,
		placed(deviceId: string, run: { runId: string }) {
			return placedRuns.has(`${deviceId} ${run.runId}`);
		},
	};
	return twin satisfies PlacedSteps;
}

/** The Offers of a test: `deviceId spaceId`. */
export function inMemorySpaceOffers() {
	const offered = new Set<string>();
	const twin = {
		offered,
		async offersInto(deviceId: string, spaceId: string) {
			return offered.has(`${deviceId} ${spaceId}`);
		},
	};
	return twin satisfies SpaceOffers;
}

/** A calling Device of a Person, with their roles from `members`. */
export function callerOf(
	members: ReturnType<typeof inMemoryMembers>,
	personId = "person-ada",
	deviceId = "device-a",
): Caller {
	return {
		personId,
		deviceId,
		device: { name: deviceId, homeHost: "host.lan" },
		roleIn: (spaceId: string) => members.roleIn(personId, spaceId),
		member: async (spaceId: string) =>
			(await members.roleIn(personId, spaceId)) !== null,
	} as unknown as Caller;
}

/**
 * Every port of the Project and Space secrets, for a computer of Ada that
 * keeps `space-1` with `project-1` in it, where Ada is an owner.
 */
export function inMemoryProjectsPorts() {
	const places = inMemoryEnginePlaces();
	places.projects.set("project-1", "space-1");
	const members = inMemoryMembers();
	members.join("person-ada", "space-1", "owner");
	members.personNames.set("person-ada", "Ada");
	return {
		places,
		spaces: inMemoryKeeperSpaces(),
		members,
		rules: inMemoryRoleRules(),
		work: inMemoryPlacedSteps(),
		offers: inMemorySpaceOffers(),
		store: inMemoryProjectSecretStore(() => 7),
		spaceStore: inMemorySpaceSecretStore(() => 7),
		calls: inMemoryHostCalls(),
		ownerId: "person-ada",
		deadlineMs: 20_000,
	};
}

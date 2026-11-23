import type { Role } from "@nightshift/auth";

/**
 * The driven ports of the Project and Space secrets. Each is filled from
 * outside the slice (`@filledBy`): the composition passes it to
 * `wireProjects`. The stores (`../kept`) and the Host calls (`../calls`)
 * are ports of their own sub-verticals.
 */

/**
 * The places the engine knows of a Project and of a run (`PeerContext`):
 * a removed Project still has its Space.
 * @filledBy engine/wire
 */
export type EnginePlaces = {
	/** The Space of a Project, removed or not. Null for one this Replica lacks. */
	spaceOf(projectId: string): Promise<string | null>;
	/** A run's Walker, Space and Project, or null for a run this Replica lacks. */
	runPlace(
		runId: string,
	): Promise<{ walkerId: string; spaceId: string; projectId: string } | null>;
};

/**
 * The Hosts that keep the Spaces this computer takes part in.
 * @filledBy devices/links
 */
export type KeeperSpaces = {
	/** The Host that keeps a Space, or null for one this computer keeps. */
	hostOf(spaceId: string): Promise<string | null>;
};

/**
 * The Members of the Spaces, from this computer's member rows.
 * @filledBy auth
 */
export type Members = {
	/** A Person's role in a Space. Null: not a Member. */
	roleIn(personId: string, spaceId: string): Promise<Role | null>;
	/** The names of these Persons, by id. One this computer does not know is missing. */
	names(personIds: readonly string[]): Promise<Map<string, string>>;
};

/**
 * What a role may do with secrets in a Space.
 * @filledBy auth
 */
export type RoleRules = {
	/** Whether the role saves Flows. */
	savesFlows(role: Role): boolean;
	/** The words of a role that does not allow a request (`ROLE_REFUSAL`). */
	refusalWords(): string;
};

/**
 * The calls of runs this Host walks or relays, to the Devices they are placed on.
 * @filledBy devices/work
 */
export type PlacedSteps = {
	/** Whether a session, a command or a tool call of the run is out to that Device now. */
	placed(
		deviceId: string,
		run: { spaceId: string; projectId: string; runId: string },
	): boolean;
};

/**
 * The Offers of the Spaces this Host keeps.
 * @filledBy devices/wire
 */
export type SpaceOffers = {
	/** Whether a Device offers profiles to a Space. */
	offersInto(deviceId: string, spaceId: string): Promise<boolean>;
};

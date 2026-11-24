import { inMemoryHostCalls } from "../calls/adapters/out/in-memory-host-calls";
import { keptStores } from "../kept/test-support";
import {
	inMemoryEnginePlaces,
	inMemoryKeeperSpaces,
	inMemoryMembers,
	inMemoryPlacedSteps,
	inMemoryRoleRules,
	inMemorySpaceOffers,
} from "./adapters/out/in-memory-neighbours";

/**
 * Every port of the Project and Space secrets, over a database in memory,
 * for a computer of Ada that keeps `space-1` with `project-1` in it, where Ada is an owner.
 */
export async function projectsPorts() {
	const { project, space } = await keptStores();
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
		store: project,
		spaceStore: space,
		calls: inMemoryHostCalls(),
		ownerId: "person-ada",
		deadlineMs: 20_000,
	};
}

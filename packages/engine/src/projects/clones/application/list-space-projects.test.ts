import { describe, expect, test } from "bun:test";
import { asDate } from "@nightshift/time";
import { inMemoryClonesPorts } from "../adapters/out/in-memory-neighbours";
import { listSpaceProjects } from "./list-space-projects";

/** `app` in `s1` with a Clone here, `lib` in `s1` without one, `old` removed, `team` in `s2`. */
async function seeded() {
	const ports = inMemoryClonesPorts();
	ports.store.addProject({
		id: "app",
		spaceId: "s1",
		name: "app",
		remote: "github.com/acme/app",
	});
	ports.store.addProject({ id: "lib", spaceId: "s1", name: "lib" });
	ports.store.addProject({
		id: "old",
		spaceId: "s1",
		name: "old",
		removedAt: asDate(9),
	});
	ports.store.addProject({ id: "team", spaceId: "s2", name: "team" });
	await ports.store.addClone({
		spaceId: "s1",
		projectId: "app",
		deviceId: "this-computer",
		path: "/work/app",
	});
	await ports.store.addClone({
		spaceId: "s1",
		projectId: "old",
		deviceId: "this-computer",
		path: "/work/old",
	});
	return ports;
}

describe("listSpaceProjects", () => {
	test("every project a person has not removed, also without a Clone here; without a Space, every Space's", async () => {
		const ports = await seeded();
		expect(
			(await listSpaceProjects(ports)({ spaceId: "s1" })).map((p) => p.id),
		).toEqual(["app", "lib"]);
		expect((await listSpaceProjects(ports)({})).map((p) => p.id)).toEqual([
			"app",
			"lib",
			"team",
		]);
	});
});

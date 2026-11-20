import { describe, expect, test } from "bun:test";
import { asDate } from "@nightshift/time";
import { PROJECT_NOT_FOUND } from "../../keep";
import { inMemoryClonesPorts } from "../adapters/out/in-memory-neighbours";
import { setClones } from "./set-clones";

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

describe("setClones", () => {
	test("makes a Device's Clones the projects it has, and again changes nothing; refused in a Space a Host keeps", async () => {
		const ports = await seeded();
		await ports.spaceProjects.create("s1", "app", {
			name: "app",
			remote: null,
			folder: true,
		});
		const request = {
			spaceId: "s1",
			deviceId: "studio",
			deviceName: "Studio",
			projectIds: ["app", "none"],
		};
		expect(await setClones(ports)(request)).toEqual({
			added: ["app"],
			removed: [],
		});
		const changes = ports.spaceProjects.records.changes.length;
		expect(await setClones(ports)(request)).toEqual({ added: [], removed: [] });
		expect(ports.spaceProjects.records.changes).toHaveLength(changes);
		ports.spaceProjects.hostElsewhere("s2");
		await expect(
			setClones(ports)({ ...request, spaceId: "s2" }),
		).rejects.toThrow(PROJECT_NOT_FOUND);
	});
});

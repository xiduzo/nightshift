import { describe, expect, test } from "bun:test";
import { asDate } from "@nightshift/time";
import { clonesPorts } from "../test-support";
import { listClones } from "./list-clones";

/** `app` in `s1` with a Clone here, `lib` in `s1` without one, `old` removed, `team` in `s2`. */
async function seeded() {
	const ports = await clonesPorts();
	await ports.addProject({
		id: "app",
		spaceId: "s1",
		name: "app",
		remote: "github.com/acme/app",
	});
	await ports.addProject({ id: "lib", spaceId: "s1", name: "lib" });
	await ports.addProject({
		id: "old",
		spaceId: "s1",
		name: "old",
		removedAt: asDate(9),
	});
	await ports.addProject({ id: "team", spaceId: "s2", name: "team" });
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

describe("listClones", () => {
	test("the Devices with a Clone, as the Space document says", async () => {
		const ports = await seeded();
		await ports.spaceProjects.recordCloneHere("s1", {
			projectId: "app",
			deviceId: "studio",
			deviceName: "Studio",
		});
		expect(
			await listClones(ports)({ spaceId: "s1", projectId: "app" }),
		).toEqual([{ deviceId: "studio", deviceName: "Studio" }]);
		expect(
			await listClones(ports)({ spaceId: "s1", projectId: "lib" }),
		).toEqual([]);
	});
});

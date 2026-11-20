import { describe, expect, test } from "bun:test";
import { asDate } from "@nightshift/time";
import { inMemoryClonesPorts } from "../adapters/out/in-memory-neighbours";
import { forgetDevice } from "./forget-device";

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

describe("forgetDevice", () => {
	test("removes a Device's Clones and its name from the Spaces kept here", async () => {
		const ports = await seeded();
		await ports.spaceProjects.create("s1", "app", {
			name: "app",
			remote: null,
			folder: true,
		});
		await ports.spaceProjects.recordCloneHere("s1", {
			projectId: "app",
			deviceId: "studio",
			deviceName: "Studio",
		});
		await forgetDevice(ports)({ deviceId: "studio" });
		const document = ports.spaceProjects.documentOf("s1");
		expect(document.clones).toEqual([]);
		expect(document.devices.has("studio")).toBe(false);
	});
});

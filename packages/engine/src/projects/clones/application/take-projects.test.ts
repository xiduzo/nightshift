import { describe, expect, test } from "bun:test";
import { asDate } from "@nightshift/time";
import { inMemoryClonesPorts } from "../adapters/out/in-memory-neighbours";
import { takeProjects } from "./take-projects";

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

describe("takeProjects", () => {
	test("new entries, removed ones back and a Device's Clones, in one change; a Space a Host keeps is left alone", async () => {
		const ports = await seeded();
		const lib = {
			id: "lib",
			name: "lib",
			remote: null,
			folder: true,
			createdAt: 1,
			removedAt: null,
		};
		await takeProjects(ports)({
			spaceId: "s1",
			taken: {
				define: [lib],
				clones: [
					{ projectId: "lib", deviceId: "studio", deviceName: "Studio" },
				],
			},
		});
		expect(ports.spaceProjects.records.changes).toEqual(["s1"]);
		expect(ports.spaceProjects.documentOf("s1").clones).toEqual([
			{ projectId: "lib", deviceId: "studio" },
		]);
		ports.spaceProjects.hostElsewhere("s2");
		await takeProjects(ports)({ spaceId: "s2", taken: { define: [lib] } });
		expect(ports.spaceProjects.records.changes).toEqual(["s1"]);
	});
});

import { describe, expect, test } from "bun:test";
import { asDate } from "@nightshift/time";
import { allowing } from "../../../access/adapters/out/in-memory-access";
import type { Actor } from "../../../contract";
import { inMemoryCatalogPorts } from "../adapters/out/in-memory-neighbours";
import { listProjects } from "./list-projects";

const ADA: Actor = { personId: "person-ada", door: "session" };

describe("listProjects", () => {
	test("the projects of the Space a person has not removed, oldest first, with their Clones, this computer first", async () => {
		const ports = inMemoryCatalogPorts();
		ports.store.addProject({ id: "a", spaceId: "s1", name: "a" });
		ports.store.addProject({ id: "b", spaceId: "s1", name: "b" });
		ports.store.addProject({ id: "c", spaceId: "s2", name: "c" });
		ports.store.addProject({
			id: "d",
			spaceId: "s1",
			name: "d",
			removedAt: asDate(5),
		});
		await ports.store.addClone({
			spaceId: "s1",
			projectId: "a",
			deviceId: "this-computer",
			path: "/a",
		});
		await ports.spaceProjects.recordCloneHere("s1", {
			projectId: "a",
			deviceId: "studio",
			deviceName: "Studio",
		});

		const listed = await listProjects(ports)(ADA, { spaceId: "s1" });
		expect(listed.map((p) => p.id)).toEqual(["a", "b"]);
		expect(listed[0]?.clones).toEqual([
			{ deviceId: "this-computer", deviceName: null, thisDevice: true },
			{ deviceId: "studio", deviceName: "Studio", thisDevice: false },
		]);
		expect(listed[1]).toMatchObject({ repoPath: null, clones: [] });
	});

	test("every Member of the Space may, whatever the role, and nobody else", async () => {
		const ports = inMemoryCatalogPorts();
		expect(
			await ports.access.whoMay("s1", (actor) =>
				listProjects(ports)(actor, { spaceId: "s1" }),
			),
		).toEqual(allowing("owner", "admin", "member", "viewer"));
	});
});

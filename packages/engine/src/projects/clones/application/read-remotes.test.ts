import { describe, expect, test } from "bun:test";
import { asDate } from "@nightshift/time";
import { inMemoryClonesPorts } from "../adapters/out/in-memory-neighbours";
import { readRemotes } from "./read-remotes";

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

describe("readRemotes", () => {
	test("fills in the remote of a project here from its Clone, and leaves a remote another project has", async () => {
		const ports = await seeded();
		ports.store.addProject({ id: "p1", spaceId: "s1", name: "site" });
		ports.store.addProject({ id: "p2", spaceId: "s1", name: "copy" });
		await ports.store.addClone({
			spaceId: "s1",
			projectId: "p1",
			deviceId: "this-computer",
			path: "/work/site",
		});
		await ports.store.addClone({
			spaceId: "s1",
			projectId: "p2",
			deviceId: "this-computer",
			path: "/work/copy",
		});
		ports.repos.add("/work/site", "git@github.com:acme/site.git");
		ports.repos.add("/work/copy", "https://github.com/acme/app.git");
		await readRemotes(ports)();
		expect(
			ports.spaceProjects.documentOf("s1").projects.get("p1")?.remote,
		).toBe("github.com/acme/site");
		expect(ports.spaceProjects.documentOf("s1").projects.has("p2")).toBe(false);
	});
});

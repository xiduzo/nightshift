import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { type Actor, NIGHT_SHIFT } from "../../../contract";
import { inMemoryCatalogPorts } from "../adapters/out/in-memory-neighbours";
import { alreadyHere, HOSTED_NEEDS_REMOTE } from "../domain/words";
import { addProject } from "./add-project";

const ADA: Actor = { personId: "person-ada", door: "session" };

describe("addProject", () => {
	test("a folder becomes a project with its remote, a Clone here, and its flows come in", async () => {
		const ports = inMemoryCatalogPorts();
		ports.repos.add("/work/app", "git@github.com:acme/app.git");
		const added = await addProject(ports)(ADA, {
			spaceId: "s1",
			repoPath: "/work/app",
		});
		expect(added).toMatchObject({
			id: "project-1",
			name: "app",
			remote: "github.com/acme/app",
			repoPath: "/work/app",
		});
		expect(ports.store.records.clones.map((c) => c.path)).toEqual([
			"/work/app",
		]);
		expect(
			ports.spaceProjects.documentOf("s1").projects.get("project-1"),
		).toMatchObject({ name: "app", folder: true });
		expect(ports.projectLog.facts.map((f) => f.type)).toEqual(["ProjectAdded"]);
		expect(ports.cloneImports.imported).toEqual(["project-1"]);
	});

	test("a folder whose origin names a known project makes a Clone of it", async () => {
		const ports = inMemoryCatalogPorts();
		ports.store.addProject({
			id: "p1",
			spaceId: "s1",
			name: "app",
			remote: "github.com/acme/app",
		});
		ports.repos.add("/work/mine", "https://github.com/acme/app.git");
		const added = await addProject(ports)(NIGHT_SHIFT, {
			spaceId: "s1",
			repoPath: "/work/mine",
		});
		expect(added.id).toBe("p1");
		expect(ports.projectLog.facts).toEqual([
			{
				type: "CloneAdded",
				payload: {
					projectId: "p1",
					deviceId: "this-computer",
					path: "/work/mine",
				},
			},
		]);
		expect(ports.store.records.clones.map((c) => c.path)).toEqual([
			"/work/mine",
		]);
	});

	test("a second folder of a project here is refused while the first exists", async () => {
		const ports = inMemoryCatalogPorts();
		ports.repos.add("/one", "git@github.com:acme/app.git");
		ports.repos.add("/two", "https://github.com/acme/app");
		await addProject(ports)(ADA, { spaceId: "s1", repoPath: "/one" });
		await expect(
			addProject(ports)(ADA, { spaceId: "s1", repoPath: "/two" }),
		).rejects.toThrow(alreadyHere("/one"));
	});

	test("a project of another Space is refused", async () => {
		const ports = inMemoryCatalogPorts();
		ports.store.addProject({
			id: "p1",
			spaceId: "s2",
			name: "app",
			remote: "github.com/acme/app",
		});
		ports.repos.add("/work/app", "git@github.com:acme/app.git");
		const refusal = await addProject(ports)(ADA, {
			spaceId: "s1",
			repoPath: "/work/app",
		}).catch((e: unknown) => e);
		expect(refusal).toBeInstanceOf(Refusal);
		expect(refusal).toMatchObject({ kind: "conflict" });
	});

	test("in a Space a Host keeps, the Host adds the project and this folder is its Clone; a folder without a remote is refused", async () => {
		const ports = inMemoryCatalogPorts();
		ports.directory.hostElsewhere("team");
		ports.spaceProjects.hostElsewhere("team");
		ports.repos.add("/work/app", "https://github.com/acme/app.git");
		const added = await addProject(ports)(ADA, {
			spaceId: "team",
			repoPath: "/work/app",
		});
		expect(added.id).toBe("hosted-1");
		expect(ports.relay.asked).toEqual([
			"addProject team github.com/acme/app",
			"addClone team hosted-1",
		]);
		ports.repos.add("/work/local");
		await expect(
			addProject(ports)(ADA, { spaceId: "team", repoPath: "/work/local" }),
		).rejects.toThrow(HOSTED_NEEDS_REMOTE);
	});
});

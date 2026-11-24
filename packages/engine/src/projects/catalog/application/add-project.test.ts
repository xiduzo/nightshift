import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { allowing } from "../../../access/adapters/out/in-memory-access";
import { type Actor, NIGHT_SHIFT } from "../../../contract";
import { alreadyHere, HOSTED_NEEDS_REMOTE } from "../domain/words";
import { catalogPorts } from "../test-support";
import { addProject } from "./add-project";

const ADA: Actor = { personId: "person-ada", door: "session" };

describe("addProject", () => {
	test("is refused in a Space whose Projects move", async () => {
		const ports = await catalogPorts();
		ports.repos.add("/work/late", "git@github.com:acme/late.git");
		ports.spaceHolds.held.add("s1");
		await expect(
			addProject(ports)(ADA, {
				spaceId: "s1",
				repoPath: "/work/late",
			}),
		).rejects.toThrow("held");
		expect(ports.spaceProjects.documentOf("s1").projects.size).toBe(0);
		expect(ports.projectLog.facts).toEqual([]);
	});

	test("a folder becomes a project with its remote, a Clone here, and its flows come in", async () => {
		const ports = await catalogPorts();
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
		expect((await ports.clones()).map((c) => c.path)).toEqual(["/work/app"]);
		expect(
			ports.spaceProjects.documentOf("s1").projects.get("project-1"),
		).toMatchObject({ name: "app", folder: true });
		expect(ports.projectLog.facts.map((f) => f.type)).toEqual(["ProjectAdded"]);
	});

	test("a folder whose origin names a known project makes a Clone of it", async () => {
		const ports = await catalogPorts();
		await ports.addProject({
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
		expect((await ports.clones()).map((c) => c.path)).toEqual(["/work/mine"]);
	});

	test("a second folder of a project here is refused while the first exists", async () => {
		const ports = await catalogPorts();
		ports.repos.add("/one", "git@github.com:acme/app.git");
		ports.repos.add("/two", "https://github.com/acme/app");
		await addProject(ports)(ADA, { spaceId: "s1", repoPath: "/one" });
		await expect(
			addProject(ports)(ADA, { spaceId: "s1", repoPath: "/two" }),
		).rejects.toThrow(alreadyHere("/one"));
	});

	test("a project of another Space is refused", async () => {
		const ports = await catalogPorts();
		await ports.addProject({
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
		const ports = await catalogPorts();
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

	test("owners, admins and members may, and nobody else", async () => {
		const ports = await catalogPorts();
		ports.repos.add("/work/app", "git@github.com:acme/app.git");
		expect(
			await ports.access.whoMay(
				"s1",
				(actor) =>
					addProject(ports)(actor, { spaceId: "s1", repoPath: "/work/app" }),
				() => ports.projectLog.facts,
			),
		).toEqual(allowing("owner", "admin", "member"));
	});

	test("a project whose folder moved follows it to the new folder", async () => {
		const ports = await catalogPorts();
		ports.repos.add("/old", "git@github.com:acme/app.git");
		const added = await addProject(ports)(ADA, {
			spaceId: "s1",
			repoPath: "/old",
		});
		ports.repos.remove("/old");
		ports.repos.add("/moved", "git@github.com:acme/app.git");
		const again = await addProject(ports)(ADA, {
			spaceId: "s1",
			repoPath: "/moved",
		});
		expect(again).toMatchObject({ id: added.id, repoPath: "/moved" });
		expect((await ports.clones()).map((c) => c.path)).toEqual(["/moved"]);
	});

	test("folders without a remote stay projects of their own, and the same folder is the same project", async () => {
		const ports = await catalogPorts();
		ports.repos.add("/a");
		ports.repos.add("/b");
		const add = (repoPath: string) =>
			addProject(ports)(ADA, { spaceId: "s1", repoPath });
		const a = await add("/a");
		const b = await add("/b");
		expect([a.remote, b.remote]).toEqual([null, null]);
		expect(a.id).not.toBe(b.id);
		expect((await add("/a")).id).toBe(a.id);
	});
});

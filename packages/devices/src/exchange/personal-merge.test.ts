import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { device, member, organization, user } from "@nightshift/db/schema";
import {
	createSandbox,
	mustGit,
	type Sandbox,
} from "@nightshift/engine/testing";
import { asDate } from "@nightshift/time";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import type { PersonalMergeInput } from "../contract";
import { type PairedReplicas, pairedReplicas } from "../testing";

/**
 * `sync.mergePersonal`: the home Host takes the Projects of a Device's own
 * personal Space into its Person's personal Space, one Project per remote.
 */

let a: Sandbox;
let b: Sandbox;
let paired: PairedReplicas;
/** The Device's own Person: not the Person of its key on the Host. */
let localPerson: string;
beforeEach(async () => {
	[a, b] = await Promise.all([createSandbox(), createSandbox()]);
	paired = await pairedReplicas(a, b);
	const [local] = await b.db.select().from(user);
	localPerson = local?.id as string;
});
afterEach(async () => {
	await Promise.all([a.cleanup(), b.cleanup()]);
});

type PersonalProject = PersonalMergeInput["projects"][number];

const call = () => paired.memory.client(paired.key).sync;

/** A git repository in the sandbox with `origin` at `remote`. */
async function repoWithRemote(sandbox: Sandbox, name: string, remote: string) {
	const path = join(sandbox.root, name);
	await mkdir(path, { recursive: true });
	await mustGit(path, ["init", "-q", "-b", "main"]);
	await mustGit(path, ["remote", "add", "origin", remote]);
	return path;
}

const local = (
	id: string,
	remote: string | null,
	extra: Partial<PersonalProject> = {},
): PersonalProject => ({
	id,
	name: id,
	remote,
	createdAt: 1_000,
	removedAt: null,
	clone: true,
	...extra,
});

/** A shared Space on the Host with the Device's Person on the Host as a Member. */
async function sharedSpace(role: string) {
	await a.db.insert(organization).values({
		id: "shared",
		name: "Platform",
		slug: "platform",
		createdAt: asDate(),
	});
	await a.db.insert(member).values({
		id: "m-shared",
		organizationId: "shared",
		userId: paired.personId,
		role,
		createdAt: asDate(),
	});
}

describe("sync.mergePersonal", () => {
	test("takes a new project with its id into the personal Space, with the device's Clone", async () => {
		const answer = await call().mergePersonal({
			personId: localPerson,
			projects: [local("p-1", "github.com/acme/app")],
		});

		expect(answer).toEqual({
			spaceId: a.spaceId,
			projectMap: { "p-1": "p-1" },
			personMap: { [localPerson]: paired.personId },
			elsewhere: [],
		});
		const [project] = await paired.host.space(a.spaceId).listProjects();
		expect(project).toMatchObject({
			id: "p-1",
			name: "p-1",
			remote: "github.com/acme/app",
		});
		expect(project?.clones.map((c) => c.deviceId)).toEqual([b.deviceId]);
	});

	test("a dry run answers the same and changes nothing", async () => {
		const answer = await call().mergePersonal({
			personId: localPerson,
			projects: [local("p-1", null)],
			dryRun: true,
		});

		expect(answer.projectMap).toEqual({ "p-1": "p-1" });
		expect(await paired.host.space(a.spaceId).listProjects()).toEqual([]);
	});

	test("a remote the personal Space has takes the id of that project", async () => {
		const hosted = await paired.host.space(a.spaceId).addProject({
			repoPath: await repoWithRemote(
				a,
				"app",
				"https://github.com/acme/app.git",
			),
		});

		const answer = await call().mergePersonal({
			personId: localPerson,
			projects: [local("p-1", "github.com/acme/app")],
		});

		expect(answer.projectMap).toEqual({ "p-1": hosted.id });
		const projects = await paired.host.space(a.spaceId).listProjects();
		expect(projects.map((p) => p.id)).toEqual([hosted.id]);
		expect(projects[0]?.clones.map((c) => c.deviceId).sort()).toEqual(
			[a.deviceId, b.deviceId].sort(),
		);
	});

	test("runs again with the same answer and adds nothing", async () => {
		const input = {
			personId: localPerson,
			projects: [local("p-1", "github.com/acme/app"), local("p-2", null)],
		};
		const first = await call().mergePersonal(input);
		const second = await call().mergePersonal(input);

		expect(second).toEqual(first);
		const projects = await paired.host.space(a.spaceId).listProjects();
		expect(projects.map((p) => p.id).sort()).toEqual(["p-1", "p-2"]);
	});

	test("a remote of a shared Space is listed and stays a personal project without that remote", async () => {
		await sharedSpace("owner");
		const shared = await paired.host.space("shared").addProject({
			repoPath: await repoWithRemote(
				a,
				"api",
				"https://github.com/acme/api.git",
			),
		});

		const answer = await call().mergePersonal({
			personId: localPerson,
			projects: [local("p-1", "github.com/acme/api")],
		});

		expect(answer.projectMap).toEqual({ "p-1": "p-1" });
		expect(answer.elsewhere).toEqual([
			{
				projectId: "p-1",
				name: "p-1",
				remote: "github.com/acme/api",
				spaceId: "shared",
				spaceName: "Platform",
				hostProjectId: shared.id,
				joined: false,
			},
		]);
		const [own] = await paired.host.space(a.spaceId).listProjects();
		expect(own).toMatchObject({ id: "p-1", remote: null });
	});

	test("a remote of a shared Space moves into its project only when the person chose it", async () => {
		await sharedSpace("owner");
		const shared = await paired.host.space("shared").addProject({
			repoPath: await repoWithRemote(
				a,
				"api",
				"https://github.com/acme/api.git",
			),
		});

		const answer = await call().mergePersonal({
			personId: localPerson,
			projects: [local("p-1", "github.com/acme/api")],
			join: ["p-1"],
		});

		expect(answer.projectMap).toEqual({ "p-1": shared.id });
		expect(answer.elsewhere[0]?.joined).toBe(true);
		expect(await paired.host.space(a.spaceId).listProjects()).toEqual([]);
		const [joined] = await paired.host.space("shared").listProjects();
		expect(joined?.clones.map((c) => c.deviceId)).toContain(b.deviceId);
	});

	test("a role that does not add projects keeps a chosen project personal", async () => {
		await sharedSpace("viewer");
		await a.db
			.update(member)
			.set({ role: "owner" })
			.where(eq(member.id, "m-shared"));
		await paired.host.space("shared").addProject({
			repoPath: await repoWithRemote(
				a,
				"api",
				"https://github.com/acme/api.git",
			),
		});
		await a.db
			.update(member)
			.set({ role: "viewer" })
			.where(eq(member.id, "m-shared"));

		const answer = await call().mergePersonal({
			personId: localPerson,
			projects: [local("p-1", "github.com/acme/api")],
			join: ["p-1"],
		});

		expect(answer.projectMap).toEqual({ "p-1": "p-1" });
		expect(answer.elsewhere[0]?.joined).toBe(false);
	});

	test("a Guest Host refuses: it keeps only shared Spaces", async () => {
		await a.db
			.update(device)
			.set({ homeHost: null })
			.where(eq(device.id, b.deviceId));

		const error = await call()
			.mergePersonal({ personId: localPerson, projects: [] })
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ORPCError);
		expect((error as ORPCError<string, unknown>).message).toContain(
			"not the home Host",
		);
	});
});

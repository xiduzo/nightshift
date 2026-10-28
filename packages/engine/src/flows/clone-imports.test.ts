import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { clone, project } from "@nightshift/db/schema";
import { singleAgentFlow } from "@nightshift/flows";
import { eq } from "drizzle-orm";
import { systemGit } from "../projects";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { createCloneImports } from "./clone-imports";
import {
	createFlowDocuments,
	type FlowDocuments,
	flowIdOf,
	flowRevisions,
	flowSources,
} from "./flow-document";

let sandbox: Sandbox;
let documents: FlowDocuments;

beforeEach(async () => {
	sandbox = await createSandbox();
	documents = createFlowDocuments({ db: sandbox.db });
	await sandbox.db.insert(project).values({
		id: "project",
		spaceId: sandbox.spaceId,
		name: "Project",
		createdAt: new Date(),
	});
	await sandbox.db.insert(clone).values({
		id: "clone",
		spaceId: sandbox.spaceId,
		projectId: "project",
		deviceId: sandbox.deviceId,
		path: sandbox.repoPath,
	});
	const flows = join(sandbox.repoPath, ".nightshift", "flows");
	await mkdir(flows, { recursive: true });
	await writeFile(
		join(flows, "quick.json"),
		JSON.stringify(
			singleAgentFlow({
				prompt: "Work",
				model: "sonnet",
				permissionMode: "acceptEdits",
			}),
		),
	);
});

afterEach(async () => {
	await documents.close();
	await sandbox.cleanup();
});

const imports = () =>
	createCloneImports({
		db: sandbox.db,
		documents,
		git: systemGit(),
		device: async () => ({ id: sandbox.deviceId, name: "laptop" }),
		now: Date.now,
	});

test("imports every Clone of this Device, once, also when two starts ask at the same time", async () => {
	const cloneImports = imports();

	await Promise.all([cloneImports.all(), cloneImports.project("project")]);

	const document = await documents.open("project");
	expect(Object.keys(flowSources(document))).toEqual(["quick"]);
	expect(
		flowRevisions(document, flowIdOf(document, "quick") as string),
	).toHaveLength(1);
	expect(existsSync(join(sandbox.repoPath, ".nightshift"))).toBe(false);
});

test("leaves the folder of a removed project alone", async () => {
	await sandbox.db
		.update(project)
		.set({ removedAt: new Date() })
		.where(eq(project.id, "project"));

	await imports().all();

	expect(flowSources(await documents.open("project"))).toEqual({});
	expect(existsSync(join(sandbox.repoPath, ".nightshift"))).toBe(true);
});

import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { clone, project } from "@nightshift/db/schema";
import { singleAgentFlow } from "@nightshift/flows";
import { asDate, now } from "@nightshift/time";
import { eq } from "drizzle-orm";
import { createFlowDocuments, type FlowDocuments } from "../documents";
import { systemGit } from "../git";
import { createSandbox, type Sandbox } from "../testing/test-support";
import {
	flowIdOf,
	flowRevisions,
	flowSources,
} from "./store/adapters/out/yjs-flow-encoding";
import { yjsFlowImports } from "./store/adapters/out/yjs-flow-store";
import { drizzleClonesHere } from "./transfer/adapters/out/drizzle-clones-here";
import { fsCloneFolders } from "./transfer/adapters/out/fs-clone-folders";
import { importCloneFolders } from "./transfer/application/import-clone-folders";
import { createImportRuns } from "./transfer/domain/import-runs";

let sandbox: Sandbox;
let documents: FlowDocuments;

beforeEach(async () => {
	sandbox = await createSandbox();
	documents = createFlowDocuments({ db: sandbox.db });
	await sandbox.db.insert(project).values({
		id: "project",
		spaceId: sandbox.spaceId,
		name: "Project",
		createdAt: asDate(),
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
	await documents.flush();
	await sandbox.cleanup();
});

/** The import on upgrade as `wire-flows.ts` binds it. */
const imports = () => {
	const importAll = importCloneFolders({
		documents: yjsFlowImports({ documents }),
		folders: fsCloneFolders({ git: systemGit() }),
		saved: documents,
		device: { device: async () => ({ id: sandbox.deviceId, name: "laptop" }) },
		clock: now,
		clones: drizzleClonesHere({ db: sandbox.db }),
		runs: createImportRuns(),
	});
	return {
		all: () => importAll({}),
		project: (projectId: string) => importAll({ projectId }),
	};
};

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
		.set({ removedAt: asDate() })
		.where(eq(project.id, "project"));

	await imports().all();

	expect(flowSources(await documents.open("project"))).toEqual({});
	expect(existsSync(join(sandbox.repoPath, ".nightshift"))).toBe(true);
});

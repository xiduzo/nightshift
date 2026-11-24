import { afterAll, beforeAll, expect, test } from "bun:test";
import type { KnowledgeSource } from "@nightshift/flows";
import { createSpaceArchive } from "../archive";
import type { Actor } from "../contract";
import { createSyncedDocuments } from "../documents";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { createKnowledgeFolderLocks, type Knowledge, wireKnowledge } from ".";

/**
 * Each request of a person goes to access with its own actor and its own
 * Space: no id takes the place of another.
 */

const ACTOR: Actor = { personId: "person", door: "session" };
const ASKED = new Error("asked");

let sandbox: Sandbox;
beforeAll(async () => {
	sandbox = await createSandbox();
});
afterAll(() => sandbox.cleanup());

/** The knowledge, with what it asked access, which refuses. */
function knowledge() {
	const asked: unknown[][] = [];
	const built = wireKnowledge({
		db: sandbox.db,
		access: {
			async openSpace(...args) {
				asked.push(args);
				throw ASKED;
			},
		},
		dataDir: sandbox.dataDir,
		documents: createSyncedDocuments({ db: sandbox.db }),
		archive: createSpaceArchive(sandbox.dataDir),
		folderLocks: createKnowledgeFolderLocks(),
		device: { id: sandbox.deviceId, name: "test" },
		notifications: { learningsChanged: async () => {} },
	});
	return { built, asked };
}

const SPACE = {} as Parameters<Knowledge["sources"]>[0];
const MAY = { schedules: true };
const BY = { id: "by", name: "By" };
const NOTE = { id: "note", index: 0 };
const CHANGES = { run: ["start"] };

const requests: Record<
	string,
	[need: object, request: (knowledge: Knowledge) => Promise<unknown>]
> = {
	setMeaning: [
		CHANGES,
		(k) =>
			k.setMeaning(ACTOR, { spaceId: "space", projectId: "project", on: true }),
	],
	look: [
		{ flow: ["save"] },
		(k) => k.look(ACTOR, { spaceId: "space", projectId: "project", urls: [] }),
	],
	setReader: [
		CHANGES,
		(k) =>
			k.setReader(ACTOR, {
				spaceId: "space",
				projectId: "project",
				setting: { kind: "nightshift" },
			}),
	],
	settleLearning: [
		CHANGES,
		(k) =>
			k.settleLearning(ACTOR, {
				spaceId: "space",
				projectId: "project",
				id: "id",
				decision: "keep",
			}),
	],
	settleNote: [
		CHANGES,
		(k) =>
			k.settleNote(ACTOR, {
				spaceId: "space",
				projectId: "project",
				note: NOTE,
				decision: "keep",
				by: BY,
			}),
	],
	tellLearning: [
		CHANGES,
		(k) =>
			k.tellLearning(ACTOR, {
				spaceId: "space",
				projectId: "project",
				note: "note",
				by: BY,
			}),
	],
	setLearnsFromRuns: [
		CHANGES,
		(k) =>
			k.setLearnsFromRuns(ACTOR, {
				spaceId: "space",
				projectId: "project",
				on: true,
			}),
	],
	markQuestion: [
		CHANGES,
		(k) =>
			k.markQuestion(ACTOR, {
				spaceId: "space",
				projectId: "project",
				query: "query",
				answers: [],
				by: null,
			}),
	],
	markNotTopic: [
		CHANGES,
		(k) =>
			k.markNotTopic(ACTOR, {
				spaceId: "space",
				projectId: "project",
				word: "word",
				notTopic: true,
				by: null,
			}),
	],
	"sources.save": [
		{ flow: ["save"] },
		(k) =>
			k.sources(SPACE).save(ACTOR, {
				spaceId: "space",
				projectId: "project",
				source: {} as KnowledgeSource,
				may: MAY,
			}),
	],
	"sources.remove": [
		{ flow: ["remove"] },
		(k) =>
			k.sources(SPACE).remove(ACTOR, {
				spaceId: "space",
				projectId: "project",
				name: "name",
				files: false,
				may: MAY,
			}),
	],
	"sources.sync": [
		CHANGES,
		(k) =>
			k.sources(SPACE).sync(ACTOR, {
				spaceId: "space",
				projectId: "project",
				name: "name",
				startedBy: "starter",
			}),
	],
};

for (const [name, [need, request]] of Object.entries(requests)) {
	test(`${name} asks with its own actor and Space`, async () => {
		const { built, asked } = knowledge();
		await expect(request(built)).rejects.toBe(ASKED);
		built.close();
		expect(asked).toEqual([[ACTOR, { spaceId: "space", need }]]);
	});
}

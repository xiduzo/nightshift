import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { member } from "@nightshift/db/schema";
import {
	type ExecEvent,
	localDevice,
	type SpaceArchive,
} from "@nightshift/engine";
import {
	createSandbox,
	type Sandbox,
	testKnowledge,
} from "@nightshift/engine/testing";
import { kitFlow } from "@nightshift/flows";
import { eq } from "drizzle-orm";
import * as Y from "yjs";
import { type PairedReplicas, pairedReplicas } from "../testing";

/**
 * Knowledge in the Space (ADR 4), across Replicas: A is the Host, B and C
 * are Devices of its owner, paired with it. Each reconciles its own
 * working copy; the content travels by hash through A's Space archive,
 * each Replica's peer engine connects its own archive to its relay, and
 * the knowledge documents sync as their Links sync them (here by hand).
 */

let a: Sandbox;
let b: Sandbox;
let c: Sandbox;
let paired: PairedReplicas;
let projectId: string;

beforeEach(async () => {
	[a, b, c] = await Promise.all([
		createSandbox(),
		createSandbox(),
		createSandbox(),
	]);
	paired = await pairedReplicas(a, b);
	({ id: projectId } = await paired.host
		.space(a.spaceId)
		.addProject({ repoPath: a.repoPath }));
	await paired.projectOnDevice(projectId);
});
afterEach(async () => {
	await paired.device.dispose();
	await paired.host.dispose();
	await Promise.all([a, b, c].map((s) => s.cleanup()));
});

/** The search indexes the tests opened, closed after each. */
const closes: (() => void)[] = [];
afterEach(() => {
	for (const close of closes.splice(0)) close();
});

/**
 * A Replica's knowledge, as the daemon assembles it: its folder, document
 * and reconcile over the Space archive of its peer engine, and itself as
 * a Device that runs commands.
 */
function knowledgeOn(sandbox: Sandbox, archive: SpaceArchive) {
	const { knowledge, documents, folder, close } = testKnowledge(sandbox, {
		pageWaitMs: 10_000,
		archive,
	});
	closes.push(close);
	knowledge.connect({ inStep: async () => {} });
	const device = localDevice({
		id: sandbox.deviceId,
		name: sandbox.deviceId,
		harnesses: {},
		knowledge,
	});
	const dir = () => folder(projectId);
	return {
		documents,
		knowledge,
		/** The folder in step with the Space, as the Knowledge page asks for it. */
		reconcile: () => knowledge.listing(projectId),
		dir,
		/** A command step on this Device, with the project's knowledge. */
		async exec(command: string): Promise<ExecEvent[]> {
			const events: ExecEvent[] = [];
			for await (const event of device.exec({
				command,
				cwd: sandbox.repoPath,
				knowledge: { projectId },
				signal: new AbortController().signal,
			})) {
				events.push(event);
			}
			return events;
		},
		read: (path: string) => readFile(join(dir(), path), "utf8"),
		has: (path: string) =>
			stat(join(dir(), path)).then(
				() => true,
				() => false,
			),
	};
}
type Knowledge = ReturnType<typeof knowledgeOn>;

/** The Host's own knowledge: its Spaces are its own, so content stays in its archive. */
function hostKnowledge() {
	return knowledgeOn(a, paired.host.archive);
}

/** The knowledge documents in step, as each Device's Link to A syncs them. */
async function linked(host: Knowledge, ...devices: Knowledge[]) {
	const docOf = async (k: Knowledge) => (await k.documents.open(projectId)).doc;
	const hub = await docOf(host);
	for (const device of devices) {
		Y.applyUpdate(hub, Y.encodeStateAsUpdate(await docOf(device)));
	}
	for (const device of devices) {
		Y.applyUpdate(await docOf(device), Y.encodeStateAsUpdate(hub));
	}
}

async function put(dir: string, path: string, text: string) {
	await mkdir(dirname(join(dir, path)), { recursive: true });
	await writeFile(join(dir, path), text);
}

describe("knowledge in the Space, across paired Devices", () => {
	test("a file a sync writes on one Device is in the folder of the Host and of another Device, with the same content", async () => {
		const third = await paired.pair(c, "C");
		await third.projectOnDevice(projectId);
		const onA = hostKnowledge();
		const onB = knowledgeOn(b, paired.device.archive);
		const onC = knowledgeOn(c, third.engine.archive);

		// A sync on B: a command step that writes into its knowledge.
		const ran = await onB.exec(
			'mkdir -p "$NS_KNOWLEDGE/wiki" && printf "# Home\\n\\nThe wiki.\\n" > "$NS_KNOWLEDGE/wiki/Home.md"',
		);
		expect(ran.at(-1)).toMatchObject({ type: "exit", exitCode: 0 });
		// Its content is in A's archive already, before its entry travels.
		const archived = await readdir(
			join(a.dataDir, "archive", a.spaceId, "knowledge"),
		);
		expect(archived).toHaveLength(1);

		await linked(onA, onB, onC);
		// A run on A, and a command on C: each reconciles before it reads.
		await onA.reconcile();
		const onCRead = await onC.exec('cat "$NS_KNOWLEDGE/wiki/Home.md"');
		expect(onCRead[0]).toMatchObject({
			type: "output",
			text: "# Home\n\nThe wiki.\n",
		});
		expect(await onA.read("wiki/Home.md")).toBe("# Home\n\nThe wiki.\n");
		// The Knowledge page on A lists it for any Member.
		const listing = await onA.reconcile();
		expect(listing.files.map((f) => f.path)).toEqual(["wiki/Home.md"]);
	});

	test("a learning proposed on one Device is kept through the review kit on another, and the first sees it accepted", async () => {
		const third = await paired.pair(c, "C");
		await third.projectOnDevice(projectId);
		const onA = hostKnowledge();
		const onB = knowledgeOn(b, paired.device.archive);
		const onC = knowledgeOn(c, third.engine.archive);

		// An agent's step on B proposed two learnings; its reconcile after the step publishes them.
		await put(
			onB.dir(),
			"learnings/proposed/run-1.md",
			"# Learnings of run run-1\n\n- Run the tests with bun.\n- The API lives in packages/api.\n",
		);
		await onB.reconcile();
		await linked(onA, onB, onC);
		// The Knowledge page on A counts them.
		expect((await onA.reconcile()).proposed).toBe(2);

		// The review runs on C: the kit's own Keep command, unchanged.
		const kit = kitFlow("kit:knowledge/review-learnings");
		const keep = kit?.nodes.find((node) => node.id === "keep");
		if (keep?.type !== "command") throw new Error("The kit has no Keep.");
		const ran = await onC.exec(
			keep.command.replace("{{list.data.files}}", "run-1.md"),
		);
		expect(ran.at(-1)).toMatchObject({ type: "exit", exitCode: 0 });
		expect(await onC.has("learnings/proposed/run-1.md")).toBe(false);

		await linked(onA, onB, onC);
		await onB.reconcile();
		await onA.reconcile();
		for (const knowledge of [onA, onB]) {
			expect(await knowledge.has("learnings/proposed/run-1.md")).toBe(false);
			expect(await knowledge.read("learnings/accepted/run-1.md")).toContain(
				"- Run the tests with bun.\n- The API lives in packages/api.\n",
			);
		}
		expect((await onA.reconcile()).proposed).toBe(0);
	});

	test("a Device that cannot reach its Host works on its own copy; its change reaches the others when the Host is back", async () => {
		const onA = hostKnowledge();
		const onB = knowledgeOn(b, paired.device.archive);
		await put(onB.dir(), "notes.md", "first\n");
		await onB.reconcile();
		await linked(onA, onB);
		await onA.reconcile();

		paired.memory.down();
		await put(onB.dir(), "notes.md", "written offline\n");
		// The step goes on: its change waits for the Host.
		await onB.reconcile();
		await linked(onA, onB);
		await onA.reconcile();
		expect(await onA.read("notes.md")).toBe("first\n");

		// The retry each minute copies what waited.
		paired.memory.up();
		await onB.knowledge.retryPending();
		await onA.reconcile();
		expect(await onA.read("notes.md")).toBe("written offline\n");
	});

	test("the Host keeps content only with its hash, from a Device of a Member who may start runs, and gives it to Members", async () => {
		const client = paired.memory.client(paired.key);
		const content = Buffer.from("# Home\n").toString("base64");
		const sha256 =
			"0000000000000000000000000000000000000000000000000000000000000000";
		await expect(
			client.archive.knowledgePut({ spaceId: a.spaceId, sha256, content }),
		).rejects.toThrow("does not have the hash");

		const bytes = new TextEncoder().encode("# Home\n");
		const hash = createHash("sha256").update(bytes).digest("hex");
		const entry = {
			ref: { kind: "content" as const, spaceId: a.spaceId, sha256: hash },
			content: bytes,
		};
		await paired.device.archive.put(entry);
		const get = () =>
			client.archive.knowledgeGet({ spaceId: a.spaceId, sha256: hash });
		expect(Buffer.from((await get()) ?? "", "base64").toString()).toBe(
			"# Home\n",
		);

		// A viewer's Device reads, and keeps nothing.
		await a.db
			.update(member)
			.set({ role: "viewer" })
			.where(eq(member.userId, paired.personId));
		await expect(paired.device.archive.put(entry)).rejects.toThrow(
			"does not allow",
		);
		expect(await get()).not.toBeNull();
	});
});

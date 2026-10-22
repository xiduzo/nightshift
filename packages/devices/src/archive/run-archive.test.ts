import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	HostUnreachableError,
	type WalkFile,
	type WalkRef,
} from "@nightshift/engine";
import { archivePath, readArchive } from "./archive";
import { createRunArchive } from "./run-archive";

/**
 * The archive keeps and carries a run's walk files: in this Replica's own
 * Space here, in a Space a Host keeps through that Host.
 */

const OWN = "own-space";
const HOSTED = "hosted-space";

let dataDir: string;
beforeEach(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "nightshift-run-archive-"));
});
afterEach(async () => {
	await rm(dataDir, { recursive: true, force: true });
});

const hostOf = async (spaceId: string) =>
	spaceId === HOSTED ? "the-host" : null;

/** A Host's archive, as the relay reaches it. */
function hostArchive() {
	const files = new Map<string, string>();
	const key = (ref: WalkRef) => archivePath("", ref);
	return {
		files,
		relay: {
			archive: async (ref: WalkRef) => files.get(key(ref)) ?? null,
			async archivePut(ref: WalkRef, content: string) {
				files.set(key(ref), content);
			},
		},
		has: (ref: WalkRef) => files.has(key(ref)),
	};
}

const walkOf = (spaceId: string): WalkFile[] => [
	{
		ref: { kind: "transcript", spaceId, runId: "run-1", stepId: "step-1" },
		content: '{"seq":1}\n',
	},
	{
		ref: { kind: "log", spaceId, runId: "run-1", stepId: "step-1" },
		content: "built\n",
	},
	{ ref: { kind: "checkpoint", spaceId, runId: "run-1" }, content: "{}" },
];

describe("the run archive", () => {
	test("keeps the walk of a run of this Replica's own Space here", async () => {
		const host = hostArchive();
		const archive = createRunArchive({ dataDir, hostOf, relay: host.relay });
		await archive.keepWalk(walkOf(OWN));
		for (const { ref, content } of walkOf(OWN)) {
			expect(await readArchive(dataDir, ref)).toBe(content);
			expect(await archive.archived(ref)).toBe(content);
		}
		expect(host.files.size).toBe(0);
	});

	test("keeps the walk of a run of a Space a Host keeps on that Host", async () => {
		const host = hostArchive();
		const archive = createRunArchive({ dataDir, hostOf, relay: host.relay });
		await archive.keepWalk(walkOf(HOSTED));
		for (const { ref, content } of walkOf(HOSTED)) {
			expect(host.has(ref)).toBe(true);
			expect(await readArchive(dataDir, ref)).toBeNull();
			// Not here: the Host's copy.
			expect(await archive.archived(ref)).toBe(content);
		}
	});

	test("cannot keep the walk of a hosted Space without a way to its Host", async () => {
		const archive = createRunArchive({ dataDir, hostOf });
		await expect(archive.keepWalk(walkOf(HOSTED))).rejects.toThrow(
			HostUnreachableError,
		);
		const checkpoint = walkOf(HOSTED).at(-1)?.ref as WalkRef;
		expect(await archive.archived(checkpoint)).toBeNull();
	});

	test("reads its own copy before the Host's", async () => {
		const host = hostArchive();
		const ref: WalkRef = { kind: "checkpoint", spaceId: OWN, runId: "run-1" };
		await host.relay.archivePut(ref, "the Host's");
		const archive = createRunArchive({ dataDir, hostOf, relay: host.relay });
		expect(await archive.archived(ref)).toBe("the Host's");
		await archive.keepWalk([{ ref, content: "this Replica's" }]);
		expect(await archive.archived(ref)).toBe("this Replica's");
	});
});

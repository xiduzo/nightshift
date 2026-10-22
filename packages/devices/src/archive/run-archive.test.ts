import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CopyStamp,
	HostUnreachableError,
	type WalkFile,
	type WalkRef,
} from "@nightshift/engine";
import {
	archivePath,
	dropArchive,
	readArchive,
	readCopy,
	writeArchive,
} from "./archive";
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
	const stamps = new Map<string, CopyStamp | undefined>();
	const key = (ref: WalkRef) => archivePath("", ref);
	return {
		files,
		relay: {
			archive: async (ref: WalkRef) => files.get(key(ref)) ?? null,
			async archivePut(ref: WalkRef, content: string, stamp?: CopyStamp) {
				files.set(key(ref), content);
				stamps.set(key(ref), stamp);
			},
		},
		has: (ref: WalkRef) => files.has(key(ref)),
		stampOf: (ref: WalkRef) => stamps.get(key(ref)),
	};
}

/** Every step as this Replica's log says: at `known`. */
const stepAt = (known: CopyStamp | null) => async () => known;
const ENDED: CopyStamp = { opening: 1, ended: true };
const transcript: WalkRef = {
	kind: "transcript",
	spaceId: HOSTED,
	runId: "run-1",
	stepId: "step-1",
};

const walkOf = (spaceId: string): WalkFile[] => [
	{
		ref: { kind: "transcript", spaceId, runId: "run-1", stepId: "step-1" },
		content: '{"seq":1}\n',
		stamp: ENDED,
	},
	{
		ref: { kind: "log", spaceId, runId: "run-1", stepId: "step-1" },
		content: "built\n",
		stamp: ENDED,
	},
	{ ref: { kind: "checkpoint", spaceId, runId: "run-1" }, content: "{}" },
];

describe("the run archive", () => {
	test("keeps the walk of a run of this Replica's own Space here", async () => {
		const host = hostArchive();
		const archive = createRunArchive({
			dataDir,
			hostOf,
			relay: host.relay,
			stepStamp: stepAt(ENDED),
		});
		await archive.keepWalk(walkOf(OWN));
		for (const { ref, content } of walkOf(OWN)) {
			expect(await readArchive(dataDir, ref)).toBe(content);
			expect(await archive.archived(ref)).toBe(content);
		}
		expect(host.files.size).toBe(0);
	});

	test("keeps the walk of a run of a Space a Host keeps on that Host", async () => {
		const host = hostArchive();
		const archive = createRunArchive({
			dataDir,
			hostOf,
			relay: host.relay,
			stepStamp: stepAt(ENDED),
		});
		await archive.keepWalk(walkOf(HOSTED));
		for (const { ref, content } of walkOf(HOSTED)) {
			expect(host.has(ref)).toBe(true);
			expect(await readArchive(dataDir, ref)).toBeNull();
			// Not here: the Host's copy.
			expect(await archive.archived(ref)).toBe(content);
		}
	});

	test("cannot keep the walk of a hosted Space without a way to its Host", async () => {
		const archive = createRunArchive({
			dataDir,
			hostOf,
			stepStamp: stepAt(ENDED),
		});
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
		const archive = createRunArchive({
			dataDir,
			hostOf,
			relay: host.relay,
			stepStamp: stepAt(ENDED),
		});
		expect(await archive.archived(ref)).toBe("the Host's");
		await archive.keepWalk([{ ref, content: "this Replica's" }]);
		expect(await archive.archived(ref)).toBe("this Replica's");
	});

	test("keeps each step's file with its stamp, here and on the Host", async () => {
		const host = hostArchive();
		const archive = createRunArchive({
			dataDir,
			hostOf,
			relay: host.relay,
			stepStamp: stepAt(ENDED),
		});
		await archive.keepWalk([...walkOf(OWN), ...walkOf(HOSTED)]);
		for (const { ref, stamp } of walkOf(HOSTED)) {
			expect(host.stampOf(ref)).toEqual(stamp);
		}
		const [own] = walkOf(OWN) as [WalkFile];
		// Here, a reader that knows the step reopened no longer takes it.
		expect(await readCopy(dataDir, own.ref, ENDED)).toBe(own.content);
		expect(
			await readCopy(dataDir, own.ref, { opening: 2, ended: true }),
		).toBeNull();
	});
});

describe("a copy of a step's file", () => {
	test("of an earlier end is not read here: the Host's copy is", async () => {
		const host = hostArchive();
		await host.relay.archivePut(transcript, "the second end");
		await writeArchive(dataDir, transcript, "the first end", ENDED);
		const archive = createRunArchive({
			dataDir,
			hostOf,
			relay: host.relay,
			stepStamp: stepAt({ opening: 2, ended: true }),
		});
		expect(await archive.archived(transcript)).toBe("the second end");
	});

	test("taken while the step ran does not hold the step once it ended", async () => {
		await writeArchive(dataDir, transcript, "a part", {
			opening: 1,
			ended: false,
		});
		expect(await readCopy(dataDir, transcript, ENDED)).toBeNull();
		expect(
			await readCopy(dataDir, transcript, { opening: 1, ended: false }),
		).toBe("a part");
	});

	test("without a stamp, from a peer of an older version, is read as before", async () => {
		await writeArchive(dataDir, transcript, "stamped", ENDED);
		// An older Walker puts the step again: its copy has no stamp.
		await writeArchive(dataDir, transcript, "unstamped");
		const archive = createRunArchive({
			dataDir,
			hostOf,
			stepStamp: stepAt({ opening: 3, ended: true }),
		});
		expect(await archive.archived(transcript)).toBe("unstamped");
	});

	test("with a stamp that is not valid holds nothing", async () => {
		await writeArchive(dataDir, transcript, "a copy", ENDED);
		await Bun.write(`${archivePath(dataDir, transcript)}.stamp`, "{");
		expect(await readCopy(dataDir, transcript, ENDED)).toBeNull();
	});

	test("goes with its stamp when this Replica drops it", async () => {
		await writeArchive(dataDir, transcript, "a copy", ENDED);
		await dropArchive(dataDir, transcript);
		expect(await readCopy(dataDir, transcript, ENDED)).toBeNull();
		expect(
			await Bun.file(`${archivePath(dataDir, transcript)}.stamp`).exists(),
		).toBe(false);
	});
});

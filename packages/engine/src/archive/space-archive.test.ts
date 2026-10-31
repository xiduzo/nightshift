import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostUnreachableError } from "../contract";
import type { CopyStamp } from "../log";
import {
	type ArchiveEntry,
	type ArchiveHost,
	type ArchiveRef,
	createSpaceArchive,
	type SpaceArchive,
	sha256Of,
	type WalkFile,
	type WalkRef,
} from "./space-archive";

/**
 * The Space archive keeps and carries what a Replica keeps of a Space for
 * the others: in this Replica's own Space here, in a Space a Host keeps
 * through that Host. Run walk files keep their stamps. Knowledge content
 * goes by its hash.
 */

const OWN = "own-space";
const HOSTED = "hosted-space";

let dataDir: string;
beforeEach(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "nightshift-space-archive-"));
});
afterEach(async () => {
	await rm(dataDir, { recursive: true, force: true });
});

const keyOf = (ref: ArchiveRef) => JSON.stringify(ref);

/** The Host that keeps HOSTED, as the relay reaches it. OWN is this Replica's. */
function memoryHost() {
	const files = new Map<string, string | Uint8Array>();
	const stamps = new Map<string, CopyStamp | undefined>();
	const state = { down: false };
	const host: ArchiveHost = {
		async archivePut(entry) {
			if (entry.ref.spaceId !== HOSTED) return false;
			if (state.down) throw new HostUnreachableError();
			files.set(keyOf(entry.ref), entry.content);
			stamps.set(keyOf(entry.ref), (entry as WalkFile).stamp);
			return true;
		},
		async archiveGet(ref) {
			if (ref.spaceId !== HOSTED) return null;
			if (state.down) throw new HostUnreachableError();
			return files.get(keyOf(ref)) ?? null;
		},
	};
	return {
		host,
		files,
		state,
		put: (entry: ArchiveEntry) => host.archivePut(entry),
		stampOf: (ref: WalkRef) => stamps.get(keyOf(ref)),
	};
}

function connected(host: ArchiveHost): SpaceArchive {
	const archive = createSpaceArchive(dataDir);
	archive.connect(host);
	return archive;
}

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

const known = (ref: WalkRef) => (ref.kind === "checkpoint" ? null : ENDED);

describe("a run's walk files", () => {
	test("of this Replica's own Space stay here", async () => {
		const host = memoryHost();
		const archive = connected(host.host);
		for (const file of walkOf(OWN)) await archive.put(file);
		for (const { ref, content } of walkOf(OWN)) {
			expect(await archive.here.read(ref, known(ref))).toBe(content);
			expect(await archive.read(ref, known(ref))).toBe(content);
		}
		expect(host.files.size).toBe(0);
	});

	test("of a Space a Host keeps go to that Host, with their stamps", async () => {
		const host = memoryHost();
		const archive = connected(host.host);
		for (const file of walkOf(HOSTED)) await archive.put(file);
		for (const { ref, content, stamp } of walkOf(HOSTED)) {
			expect(host.stampOf(ref)).toEqual(stamp);
			expect(await archive.here.read(ref, known(ref))).toBeNull();
			// Not here: the Host's copy.
			expect(await archive.read(ref, known(ref))).toBe(content);
		}
	});

	test("cannot go anywhere before the Hosts are connected, nor while the Host is away", async () => {
		const archive = createSpaceArchive(dataDir);
		const [file] = walkOf(OWN) as [WalkFile];
		await expect(archive.put(file)).rejects.toThrow(HostUnreachableError);
		expect(await archive.read(file.ref, ENDED)).toBeNull();

		const host = memoryHost();
		host.state.down = true;
		archive.connect(host.host);
		const [hosted] = walkOf(HOSTED) as [WalkFile];
		await expect(archive.put(hosted)).rejects.toThrow(HostUnreachableError);
		await expect(archive.read(hosted.ref, ENDED)).rejects.toThrow(
			HostUnreachableError,
		);
	});

	test("are read here before the Host's", async () => {
		const host = memoryHost();
		const ref: WalkRef = { kind: "checkpoint", spaceId: HOSTED, runId: "r" };
		await host.put({ ref, content: "the Host's" });
		const archive = connected(host.host);
		expect(await archive.read(ref, null)).toBe("the Host's");
		await archive.here.write({ ref, content: "this Replica's" });
		expect(await archive.read(ref, null)).toBe("this Replica's");
	});

	test("from the Host are kept here once the step ended, and only then", async () => {
		const host = memoryHost();
		await host.put({ ref: transcript, content: "a part", stamp: ENDED });
		const archive = connected(host.host);
		const running = { opening: 1, ended: false };
		expect(await archive.read(transcript, running)).toBe("a part");
		expect(await archive.here.read(transcript, running)).toBeNull();

		expect(await archive.read(transcript, ENDED)).toBe("a part");
		host.state.down = true;
		expect(await archive.read(transcript, ENDED)).toBe("a part");
	});
});

describe("a copy of a step's file", () => {
	test("of an earlier end is not read here: the Host's copy is", async () => {
		const host = memoryHost();
		await host.put({ ref: transcript, content: "the second end" });
		const archive = connected(host.host);
		await archive.here.write({
			ref: transcript,
			content: "the first end",
			stamp: ENDED,
		});
		expect(await archive.read(transcript, { opening: 2, ended: true })).toBe(
			"the second end",
		);
	});

	test("taken while the step ran does not hold the step once it ended", async () => {
		const archive = createSpaceArchive(dataDir);
		await archive.here.write({
			ref: transcript,
			content: "a part",
			stamp: { opening: 1, ended: false },
		});
		expect(await archive.here.read(transcript, ENDED)).toBeNull();
		expect(
			await archive.here.read(transcript, { opening: 1, ended: false }),
		).toBe("a part");
	});

	test("without a stamp, from a peer of an older version, is read as before", async () => {
		const archive = createSpaceArchive(dataDir);
		await archive.here.write({ ref: transcript, content: "s", stamp: ENDED });
		// An older Walker puts the step again: its copy has no stamp.
		await archive.here.write({ ref: transcript, content: "unstamped" });
		expect(
			await archive.here.read(transcript, { opening: 3, ended: true }),
		).toBe("unstamped");
	});

	test("with a stamp that is not valid holds nothing", async () => {
		const archive = createSpaceArchive(dataDir);
		await archive.here.write({ ref: transcript, content: "c", stamp: ENDED });
		const path = join(dataDir, "archive", HOSTED, "run-1", "step-1.ndjson");
		await Bun.write(`${path}.stamp`, "{");
		expect(await archive.here.read(transcript, ENDED)).toBeNull();
	});

	test("goes with its stamp when this Replica drops it", async () => {
		const archive = createSpaceArchive(dataDir);
		await archive.here.write({ ref: transcript, content: "c", stamp: ENDED });
		await archive.here.drop(transcript);
		expect(await archive.here.read(transcript, ENDED)).toBeNull();
		expect(await readdir(join(dataDir, "archive", HOSTED, "run-1"))).toEqual(
			[],
		);
	});

	test("written twice at once, in one process, is one of the two whole, with its own stamp", async () => {
		// Two puts of the same step on a Host: a Walker's push, and the push
		// again after its link came back.
		const archive = createSpaceArchive(dataDir);
		const big = (end: number) => `entry of end ${end}\n`.repeat(20_000);
		for (let round = 0; round < 5; round++) {
			await Promise.all(
				[1, 2].map((end) =>
					archive.here.write({
						ref: transcript,
						content: big(end),
						stamp: { opening: end, ended: true },
					}),
				),
			);
			const [one, two] = await Promise.all(
				[1, 2].map((end) =>
					archive.here.read(transcript, { opening: end, ended: true }),
				),
			);
			// Exactly one end holds, whole.
			expect([one, two].filter((c) => c !== null)).toHaveLength(1);
			expect([big(1), big(2)]).toContain((one ?? two) as string);
		}
	});
});

describe("knowledge content", () => {
	const bytes = new TextEncoder().encode("# Home\n");
	const sha256 = sha256Of(bytes);
	const content = (spaceId: string) => ({
		ref: { kind: "content" as const, spaceId, sha256 },
		content: bytes,
	});

	test("stays here, and goes to the Host of a Space a Host keeps", async () => {
		const host = memoryHost();
		const archive = connected(host.host);
		await archive.put(content(OWN));
		await archive.put(content(HOSTED));
		expect(await archive.here.read(content(OWN).ref)).toEqual(bytes);
		expect(await archive.here.read(content(HOSTED).ref)).toEqual(bytes);
		expect([...host.files.values()]).toEqual([bytes]);
	});

	test("stays here before the Hosts are connected, and says it did not go", async () => {
		const archive = createSpaceArchive(dataDir);
		await expect(archive.put(content(HOSTED))).rejects.toThrow(
			HostUnreachableError,
		);
		expect(await archive.read(content(HOSTED).ref)).toEqual(bytes);
	});

	test("from the Host is kept here, and only with the hash it names", async () => {
		const host = memoryHost();
		await host.put(content(HOSTED));
		const archive = connected(host.host);
		expect(await archive.read(content(HOSTED).ref)).toEqual(bytes);
		host.state.down = true;
		expect(await archive.read(content(HOSTED).ref)).toEqual(bytes);

		host.state.down = false;
		const other = {
			kind: "content" as const,
			spaceId: HOSTED,
			sha256: "0".repeat(64),
		};
		host.files.set(keyOf(other), bytes);
		expect(await archive.read(other)).toBeNull();
		expect(await archive.here.read(other)).toBeNull();
	});

	test("that does not have its hash is refused", async () => {
		const archive = createSpaceArchive(dataDir);
		await expect(
			archive.here.write({
				ref: { kind: "content", spaceId: OWN, sha256: "0".repeat(64) },
				content: bytes,
			}),
		).rejects.toThrow("The content does not have the hash it names.");
	});
});

test("an id that is not one path segment is refused", async () => {
	const archive = createSpaceArchive(dataDir);
	await expect(
		archive.here.read({ kind: "checkpoint", spaceId: "..", runId: "r" }, null),
	).rejects.toThrow("is not an id");
	await expect(
		archive.here.read({ kind: "content", spaceId: OWN, sha256: "../x" }),
	).rejects.toThrow("is not a hash");
});

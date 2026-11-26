import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fsReadMarks } from "./fs-read-marks";

/** How the file of the marks is written, past the contract: whole or not at all. */

let dataDir: string;
let reads: string;

beforeEach(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "nightshift-read-marks-"));
	reads = join(dataDir, "knowledge", ".reads");
});

afterEach(async () => {
	await rm(dataDir, { recursive: true, force: true });
});

const pageOf = (n: number) => `https://example.com/docs/${n}`;

test("two flushes at once leave a file that reads back", async () => {
	const warn = spyOn(console, "warn").mockImplementation(() => {});
	try {
		const many = fsReadMarks(dataDir);
		const few = fsReadMarks(dataDir);
		for (let n = 0; n < 2_000; n++) {
			await many.set("p1", "nightshift", pageOf(n), {
				mark: { fingerprint: `many-${n}` },
				links: [pageOf(n + 1), pageOf(n + 2)],
			});
		}
		await few.set("p1", "nightshift", pageOf(0), {
			mark: { fingerprint: "few-0" },
			links: [],
		});

		await Promise.all([many.flush(), few.flush()]);

		const seen = await fsReadMarks(dataDir).get("p1", "nightshift", pageOf(0));
		expect(["many-0", "few-0"]).toContain(seen?.mark.fingerprint ?? "none");
		expect(await readdir(reads)).toEqual(["p1.json"]);
		expect(warn).not.toHaveBeenCalled();
	} finally {
		warn.mockRestore();
	}
});

test("a failed write leaves what was there and no part file", async () => {
	const warn = spyOn(console, "warn").mockImplementation(() => {});
	try {
		// A folder where the file goes: the last step of the write fails.
		await mkdir(join(reads, "p1.json", "kept"), { recursive: true });
		await writeFile(join(reads, "p1.json", "kept", "note"), "old");
		const marks = fsReadMarks(dataDir);
		await marks.set("p1", "nightshift", pageOf(0), {
			mark: { fingerprint: "f1" },
			links: [],
		});

		await marks.flush();

		expect(await readdir(reads)).toEqual(["p1.json"]);
		expect(await readdir(join(reads, "p1.json", "kept"))).toEqual(["note"]);
	} finally {
		warn.mockRestore();
	}
});

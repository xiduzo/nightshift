import { describe, expect, test } from "bun:test";
import { syncPorts } from "../test-support";
import { collectUnlistedContent } from "./collect-unlisted-content";

/** The use case collectUnlistedContent, over a database in memory. */

const DAY = 24 * 60 * 60_000;
const NOW = 100 * DAY;

async function collectPorts() {
	const ports = await syncPorts();
	ports.setNow(NOW);
	ports.hosts.kept.add("s1");
	const keep = (spaceId: string, char: string, ageDays: number) => {
		const ref = { kind: "content" as const, spaceId, sha256: char.repeat(64) };
		ports.archive.keepHere(ref, new Uint8Array([1]), NOW - ageDays * DAY);
		return ref;
	};
	return { ports, keep, collect: collectUnlistedContent(ports) };
}

describe("collectUnlistedContent", () => {
	test("removes what no document lists once the grace period is over, and keeps the rest", async () => {
		const { ports, keep, collect } = await collectPorts();
		const listed = keep("s1", "a", 30);
		const old = keep("s1", "b", 30);
		const fresh = keep("s1", "c", 1);
		await (await ports.documents.open("p1")).apply({
			set: [
				[
					"a.md",
					{ sha256: listed.sha256, size: 1, changedAt: 1, deviceId: "d1" },
				],
			],
		});
		expect(await collect()).toEqual({ removed: 1, waiting: 1 });
		expect(ports.archive.hasHere(old)).toBe(false);
		expect(ports.archive.hasHere(listed)).toBe(true);
		expect(ports.archive.hasHere(fresh)).toBe(true);
	});

	test("leaves the content of a Space this Replica does not keep", async () => {
		const { ports, keep, collect } = await collectPorts();
		const cached = keep("s2", "d", 30);
		expect(await collect()).toEqual({ removed: 0, waiting: 0 });
		expect(ports.archive.hasHere(cached)).toBe(true);
	});

	test("a hash a value of another version names stays", async () => {
		const { ports, keep, collect } = await collectPorts();
		const named = keep("s1", "e", 30);
		ports.documents.listRaw("p1", "a.md", { sha256: named.sha256, v: 9 });
		expect(await collect()).toEqual({ removed: 0, waiting: 0 });
	});
});

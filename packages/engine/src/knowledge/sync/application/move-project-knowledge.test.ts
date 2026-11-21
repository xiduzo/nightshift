import { describe, expect, test } from "bun:test";
import { inMemorySyncPorts } from "../adapters/out/in-memory-neighbours";
import { moveProjectKnowledge } from "./move-project-knowledge";

/** The use case moveProjectKnowledge, on in-memory adapters. */

const bytes = (text: string) => new TextEncoder().encode(text);

async function withKnowledge() {
	const ports = inMemorySyncPorts();
	const sha256 = ports.copy.hash("# A\n");
	ports.copy.put("p1", "a.md", "# A\n", 5);
	ports.archive.keepHere(
		{ kind: "content", spaceId: "s1", sha256 },
		bytes("# A\n"),
	);
	await (await ports.documents.open("p1")).apply({
		set: [["a.md", { sha256, size: 4, changedAt: 5, deviceId: "laptop" }]],
	});
	return { ports, sha256 };
}

describe("moveProjectKnowledge", () => {
	test("to another Space with the same id: the content goes to the new Space's archive and waits for its Host", async () => {
		const { ports, sha256 } = await withKnowledge();
		await moveProjectKnowledge(ports)({
			from: { spaceId: "s1", projectId: "p1" },
			to: { spaceId: "s2", projectId: "p1" },
		});
		expect(
			ports.archive.hasHere({ kind: "content", spaceId: "s2", sha256 }),
		).toBe(true);
		const state = JSON.parse(ports.copy.state("p1") ?? "{}");
		expect(state.unpushed).toEqual([sha256]);
		expect(ports.pending.has("p1")).toBe(true);
		expect(ports.copy.text("p1", "a.md")).toBe("# A\n");
	});

	test("to a new id: the folder moves, the old document goes, and the next reconcile is an import", async () => {
		const { ports, sha256 } = await withKnowledge();
		await moveProjectKnowledge(ports)({
			from: { spaceId: "s1", projectId: "p1" },
			to: { spaceId: "s2", projectId: "p9" },
		});
		expect(ports.copy.calls).toContain("move p1 p9");
		expect(ports.copy.text("p9", "a.md")).toBe("# A\n");
		expect(await ports.copy.exists("p1")).toBe(false);
		expect((await ports.documents.open("p1")).entries().size).toBe(0);
		const state = JSON.parse(ports.copy.state("p9") ?? "{}");
		expect(state).toEqual({ files: {}, unpushed: [sha256] });
		expect(ports.pending.has("p9")).toBe(true);
	});

	test("a project with no knowledge here: nothing happens", async () => {
		const ports = inMemorySyncPorts();
		await moveProjectKnowledge(ports)({
			from: { spaceId: "s1", projectId: "p1" },
			to: { spaceId: "s2", projectId: "p1" },
		});
		expect(ports.copy.calls).toEqual([]);
		expect(ports.pending.size).toBe(0);
	});
});

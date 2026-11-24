import { describe, expect, test } from "bun:test";
import { syncPorts } from "../test-support";
import { removeSourceFolder } from "./remove-source-folder";

/** The use case removeSourceFolder, over a database in memory. */

const entry = (char: string) => ({
	sha256: char.repeat(64),
	size: 1,
	changedAt: 1,
	deviceId: "desktop",
});

async function removePorts() {
	const ports = await syncPorts();
	const order: string[] = [];
	return {
		ports,
		order,
		remove: removeSourceFolder({
			...ports,
			reconcile: async (projectId) => {
				order.push(`reconcile ${projectId}`);
			},
		}),
	};
}

describe("removeSourceFolder", () => {
	test("removes the folder's entries between two reconciles, and counts them", async () => {
		const { ports, order, remove } = await removePorts();
		const document = await ports.documents.open("p1");
		await document.apply({
			set: [
				["web/a.md", entry("a")],
				["web/b.md", entry("b")],
				["website/c.md", entry("c")],
			],
		});
		expect(await remove({ projectId: "p1", folder: "web/" })).toBe(2);
		expect(order).toEqual(["reconcile p1", "reconcile p1"]);
		expect([...document.entries().keys()]).toEqual(["website/c.md"]);
	});

	test("refuses a folder outside the knowledge and one of Night Shift's own", async () => {
		const { remove } = await removePorts();
		for (const folder of ["../web", ".hidden", "learnings"]) {
			await expect(remove({ projectId: "p1", folder })).rejects.toThrow(
				"Choose a folder inside the knowledge.",
			);
		}
	});

	test("refuses while a run changes the knowledge", async () => {
		const { ports, order, remove } = await removePorts();
		ports.locks.hold("/knowledge/p1");
		await expect(remove({ projectId: "p1", folder: "web" })).rejects.toThrow(
			"A run is changing this knowledge now. Try again when it ends.",
		);
		expect(order).toEqual([]);
	});
});

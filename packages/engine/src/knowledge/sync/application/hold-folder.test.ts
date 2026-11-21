import { describe, expect, test } from "bun:test";
import { inMemorySyncPorts } from "../adapters/out/in-memory-neighbours";
import { holdFolder } from "./hold-folder";

/** The use case holdFolder, on in-memory adapters. */

function holdPorts() {
	const ports = inMemorySyncPorts();
	const reconciled: string[] = [];
	return {
		ports,
		reconciled,
		hold: holdFolder({
			copy: ports.copy,
			locks: ports.locks,
			reconcile: async (projectId) => {
				reconciled.push(projectId);
			},
		}),
	};
}

describe("holdFolder", () => {
	test("the first hold reconciles before, the last after, and the folder is held between", async () => {
		const { ports, reconciled, hold } = holdPorts();
		const a = await hold({ projectId: "p1" });
		expect(reconciled).toEqual(["p1"]);
		const b = await hold({ projectId: "p1" });
		expect(reconciled).toEqual(["p1"]);
		expect(ports.locks.held("/knowledge/p1")).toBe(true);
		await a.done();
		expect(reconciled).toEqual(["p1"]);
		await b.done();
		expect(reconciled).toEqual(["p1", "p1"]);
		expect(ports.locks.held("/knowledge/p1")).toBe(false);
	});

	test("done twice lets go once", async () => {
		const { ports, reconciled, hold } = holdPorts();
		const a = await hold({ projectId: "p1" });
		const b = await hold({ projectId: "p1" });
		await a.done();
		await a.done();
		expect(ports.locks.held("/knowledge/p1")).toBe(true);
		await b.done();
		expect(reconciled).toEqual(["p1", "p1"]);
	});

	test("a reconcile that fails leaves the folder as it is: the step goes on", async () => {
		const ports = inMemorySyncPorts();
		const hold = holdFolder({
			copy: ports.copy,
			locks: ports.locks,
			reconcile: async () => {
				throw new Error("The disk is full.");
			},
		});
		const step = await hold({ projectId: "p1" });
		await step.done();
		expect(ports.locks.held("/knowledge/p1")).toBe(false);
	});

	test("a second step waits for the turns of the folder so far", async () => {
		const { ports, hold } = holdPorts();
		const order: string[] = [];
		let release = () => {};
		const turn = ports.locks.inTurn("/knowledge/p1", async () => {
			await new Promise<void>((resolve) => (release = resolve));
			order.push("turn");
		});
		await hold({ projectId: "p1" });
		const second = hold({ projectId: "p1" }).then(() => order.push("second"));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(order).toEqual([]);
		release();
		await Promise.all([turn, second]);
		expect(order).toEqual(["turn", "second"]);
	});
});

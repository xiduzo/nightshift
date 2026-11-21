import { describe, expect, test } from "bun:test";
import { inMemorySyncPorts } from "../adapters/out/in-memory-neighbours";
import { reconcileAllFolders } from "./reconcile-all-folders";

/** The use case reconcileAllFolders, on in-memory adapters. */

describe("reconcileAllFolders", () => {
	test("reconciles every folder one after the other, but not one a step holds", async () => {
		const ports = inMemorySyncPorts();
		for (const projectId of ["p1", "p2", "p3"]) {
			await ports.copy.ensure(projectId);
		}
		ports.locks.hold("/knowledge/p2");
		const reconciled: string[] = [];
		await reconcileAllFolders({
			...ports,
			reconcile: async (projectId) => {
				reconciled.push(projectId);
			},
		})();
		expect(reconciled).toEqual(["p1", "p3"]);
	});

	test("a folder that fails does not stop the others", async () => {
		const ports = inMemorySyncPorts();
		for (const projectId of ["p1", "p2"]) await ports.copy.ensure(projectId);
		const reconciled: string[] = [];
		await reconcileAllFolders({
			...ports,
			reconcile: async (projectId) => {
				if (projectId === "p1") throw new Error("The disk is full.");
				reconciled.push(projectId);
			},
		})();
		expect(reconciled).toEqual(["p2"]);
	});
});

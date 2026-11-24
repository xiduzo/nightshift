import { describe, expect, test } from "bun:test";
import { syncPorts } from "../test-support";
import { reconcileAllFolders } from "./reconcile-all-folders";

/** The use case reconcileAllFolders, over a database in memory. */

describe("reconcileAllFolders", () => {
	test("reconciles every folder one after the other, but not one a step holds", async () => {
		const ports = await syncPorts();
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
		const ports = await syncPorts();
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

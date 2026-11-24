import { describe, expect, test } from "bun:test";
import { syncPorts } from "../test-support";
import { retryPendingFolders } from "./retry-pending-folders";

/** The use case retryPendingFolders, over a database in memory. */

describe("retryPendingFolders", () => {
	test("reconciles only the folders whose content waits, and not one a step holds", async () => {
		const ports = await syncPorts();
		ports.pending.add("p1");
		ports.pending.add("p2");
		ports.locks.hold("/knowledge/p2");
		await ports.copy.ensure("p3");
		const reconciled: string[] = [];
		await retryPendingFolders({
			...ports,
			reconcile: async (projectId) => {
				reconciled.push(projectId);
			},
		})();
		expect(reconciled).toEqual(["p1"]);
	});

	test("a failure waits for the next time", async () => {
		const ports = await syncPorts();
		ports.pending.add("p1");
		ports.pending.add("p2");
		const reconciled: string[] = [];
		await retryPendingFolders({
			...ports,
			reconcile: async (projectId) => {
				if (projectId === "p1") throw new Error("The Host is down.");
				reconciled.push(projectId);
			},
		})();
		expect(reconciled).toEqual(["p2"]);
	});
});

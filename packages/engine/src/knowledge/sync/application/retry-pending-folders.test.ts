import { describe, expect, test } from "bun:test";
import { inMemorySyncPorts } from "../adapters/out/in-memory-neighbours";
import { retryPendingFolders } from "./retry-pending-folders";

/** The use case retryPendingFolders, on in-memory adapters. */

describe("retryPendingFolders", () => {
	test("reconciles only the folders whose content waits, and not one a step holds", async () => {
		const ports = inMemorySyncPorts();
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
		const ports = inMemorySyncPorts();
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

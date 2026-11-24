import { describe, expect, test } from "bun:test";
import { syncPorts } from "../test-support";
import { reconcileUnlessHeld } from "./reconcile-unless-held";

/** The use case reconcileUnlessHeld, over a database in memory. */

describe("reconcileUnlessHeld", () => {
	test("reconciles a folder no step holds", async () => {
		const ports = await syncPorts();
		const reconciled: string[] = [];
		await reconcileUnlessHeld({
			...ports,
			reconcile: async (projectId) => {
				reconciled.push(projectId);
			},
		})({ projectId: "p1" });
		expect(reconciled).toEqual(["p1"]);
	});

	test("leaves a folder a step holds", async () => {
		const ports = await syncPorts();
		ports.locks.hold("/knowledge/p1");
		const reconciled: string[] = [];
		await reconcileUnlessHeld({
			...ports,
			reconcile: async (projectId) => {
				reconciled.push(projectId);
			},
		})({ projectId: "p1" });
		expect(reconciled).toEqual([]);
	});

	test("never fails", async () => {
		const ports = await syncPorts();
		const answer = reconcileUnlessHeld({
			...ports,
			reconcile: async () => {
				throw new Error("The disk is full.");
			},
		})({ projectId: "p1" });
		expect(await answer).toBeUndefined();
	});
});

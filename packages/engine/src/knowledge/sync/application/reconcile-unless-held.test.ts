import { describe, expect, test } from "bun:test";
import { inMemorySyncPorts } from "../adapters/out/in-memory-neighbours";
import { reconcileUnlessHeld } from "./reconcile-unless-held";

/** The use case reconcileUnlessHeld, on in-memory adapters. */

describe("reconcileUnlessHeld", () => {
	test("reconciles a folder no step holds", async () => {
		const ports = inMemorySyncPorts();
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
		const ports = inMemorySyncPorts();
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
		const ports = inMemorySyncPorts();
		const answer = reconcileUnlessHeld({
			...ports,
			reconcile: async () => {
				throw new Error("The disk is full.");
			},
		})({ projectId: "p1" });
		expect(await answer).toBeUndefined();
	});
});

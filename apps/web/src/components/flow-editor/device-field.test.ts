import { describe, expect, test } from "bun:test";
import type { FlowNode } from "@nightshift/flows";

import { runsOnDevice, withDevice } from "./device-field";

const node = (fields: Record<string, unknown>) =>
	({ id: "n", position: { x: 0, y: 0 }, ...fields }) as unknown as FlowNode;

describe("a node's Device", () => {
	test("an Agent, a Command, a Tool and a model Decision or Value run on one", () => {
		expect(runsOnDevice(node({ type: "agent" }))).toBe(true);
		expect(runsOnDevice(node({ type: "command" }))).toBe(true);
		expect(runsOnDevice(node({ type: "tool" }))).toBe(true);
		expect(runsOnDevice(node({ type: "decision", by: "model" }))).toBe(true);
		expect(runsOnDevice(node({ type: "decision", by: "person" }))).toBe(false);
		expect(runsOnDevice(node({ type: "value", by: "rule" }))).toBe(false);
		expect(runsOnDevice(node({ type: "wait" }))).toBe(false);
	});

	test("setting it, and back to the run's device", () => {
		const placed = withDevice(node({ type: "command" }), "hetzner-1");
		expect(placed).toMatchObject({ device: "hetzner-1" });
		expect("device" in withDevice(placed, undefined)).toBe(false);
		const gate = node({ type: "decision", by: "person" });
		expect(withDevice(gate, "hetzner-1")).toBe(gate);
	});
});

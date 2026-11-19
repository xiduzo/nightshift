import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../contract";
import {
	inMemoryGatePorts,
	openGate,
} from "../adapters/out/in-memory-neighbours";
import { listInbox } from "./list-inbox";

describe("listInbox", () => {
	test("lists the open Gates of every Space the Person is in, in one order, with each Space's name and whether they may answer", async () => {
		const ports = inMemoryGatePorts();
		ports.spaces.space("platform", "Platform");
		ports.spaces.space("docs", "Docs");
		ports.spaces.space("elsewhere", "Elsewhere");
		ports.spaces.join("platform", "u-ada", "member");
		ports.spaces.join("docs", "u-ada", "viewer");
		ports.spaces.join("elsewhere", "u-bob", "owner");
		ports.gates.setOpen("platform", [
			openGate("platform", "platform-late", 30),
		]);
		ports.gates.setOpen("docs", [openGate("docs", "docs-early", 10)]);
		ports.gates.setOpen("elsewhere", [openGate("elsewhere", "not-hers", 1)]);

		const inbox = await listInbox(ports)({ personId: "u-ada" });
		expect(
			inbox.map((gate) => [gate.runId, gate.spaceName, gate.canAnswer]),
		).toEqual([
			["docs-early", "Docs", false],
			["platform-late", "Platform", true],
		]);
		// Each of her Spaces is read; a Space she is not in is not read.
		expect([...ports.gates.asked].sort()).toEqual(["docs", "platform"]);
		expect(ports.spaces.asked).toEqual(["u-ada"]);
	});

	test("Night Shift has no inbox", async () => {
		const ports = inMemoryGatePorts();
		const refused = await listInbox(ports)(NIGHT_SHIFT).then(
			() => null,
			(error: { kind?: string; message?: string }) => error,
		);
		expect(refused?.kind).toBe("signed-out");
		expect(refused?.message).toBe(
			"Sign in to see the Gates that wait for you.",
		);
	});
});

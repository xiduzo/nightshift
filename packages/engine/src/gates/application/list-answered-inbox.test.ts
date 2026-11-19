import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../contract";
import type { AnsweredGate } from "../../read";
import { inMemoryGatePorts } from "../adapters/out/in-memory-neighbours";
import { INBOX_KEEP_MS } from "../domain/inbox-order";
import { listAnsweredInbox } from "./list-answered-inbox";

/** An answered Gate of a run, closed at `closedAt`. */
const answered = (spaceId: string, runId: string, closedAt: number) =>
	({ spaceId, runId, stepId: "s", closedAt }) as AnsweredGate;

describe("listAnsweredInbox", () => {
	test("lists the Gates of every Space the Person is in that closed in the last 90 days, newest first, with each Space's name", async () => {
		const now = 1_000 * INBOX_KEEP_MS;
		const ports = inMemoryGatePorts({ now });
		ports.spaces.space("platform", "Platform");
		ports.spaces.space("docs", "Docs");
		ports.spaces.space("elsewhere", "Elsewhere");
		ports.spaces.join("platform", "u-ada", "viewer");
		ports.spaces.join("docs", "u-ada", "member");
		ports.spaces.join("elsewhere", "u-bob", "owner");
		ports.gates.setAnswered("platform", [
			answered("platform", "too-old", now - INBOX_KEEP_MS - 1),
			answered("platform", "older", now - 20),
		]);
		ports.gates.setAnswered("docs", [answered("docs", "newer", now - 10)]);
		ports.gates.setAnswered("elsewhere", [
			answered("elsewhere", "not-hers", now - 1),
		]);

		const inbox = await listAnsweredInbox(ports)({ personId: "u-ada" });
		expect(inbox.map((gate) => [gate.runId, gate.spaceName])).toEqual([
			["newer", "Docs"],
			["older", "Platform"],
		]);
	});

	test("Night Shift has no inbox", async () => {
		const ports = inMemoryGatePorts();
		const refused = await listAnsweredInbox(ports)(NIGHT_SHIFT).then(
			() => null,
			(error: { kind?: string }) => error,
		);
		expect(refused?.kind).toBe("signed-out");
	});
});

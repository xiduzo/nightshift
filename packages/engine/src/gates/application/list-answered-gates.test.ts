import { describe, expect, test } from "bun:test";
import type { AnsweredGate } from "../../read";
import {
	ADA,
	inMemoryGatePorts,
	SPACE,
} from "../adapters/out/in-memory-neighbours";
import { listAnsweredGates } from "./list-answered-gates";

/** An answered Gate of a run in `SPACE`, closed at `closedAt`. */
const answered = (runId: string, closedAt: number) =>
	({ spaceId: SPACE, runId, stepId: "s", closedAt }) as AnsweredGate;

describe("listAnsweredGates", () => {
	test("lists the Gates of one Space that closed after the moment given", async () => {
		const ports = inMemoryGatePorts();
		ports.gates.setAnswered(SPACE, [answered("old", 5), answered("new", 50)]);
		const list = listAnsweredGates(ports);
		expect(
			(await list(ADA, { spaceId: SPACE, since: 10 })).map((g) => g.runId),
		).toEqual(["new"]);
	});

	test("a Person who is not a Member of the Space does not find it", async () => {
		const ports = inMemoryGatePorts();
		const refused = await listAnsweredGates(ports)(
			{ personId: "person-nobody" },
			{ spaceId: SPACE, since: 0 },
		).then(
			() => null,
			(error: { kind?: string }) => error,
		);
		expect(refused?.kind).toBe("not-found");
		expect(ports.gates.asked).toEqual([]);
	});
});

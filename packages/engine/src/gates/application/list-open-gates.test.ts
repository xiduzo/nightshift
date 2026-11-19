import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../contract";
import {
	ADA,
	inMemoryGatePorts,
	openGate,
	SPACE,
} from "../adapters/out/in-memory-neighbours";
import { listOpenGates } from "./list-open-gates";

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error as { kind?: string },
	);

describe("listOpenGates", () => {
	test("lists the open Gates of one Space, as the views of its runs show them", async () => {
		const ports = inMemoryGatePorts();
		const gates = [openGate(SPACE, "a", 1), openGate(SPACE, "b", 2)];
		ports.gates.setOpen(SPACE, gates);
		ports.gates.setOpen("space-2", [openGate("space-2", "c", 0)]);
		const list = listOpenGates(ports);
		expect(await list(ADA, { spaceId: SPACE })).toEqual(gates);
		// Night Shift (the notifier) reads every Space.
		expect(await list(NIGHT_SHIFT, { spaceId: "space-2" })).toHaveLength(1);
	});

	test("a Person who is not a Member of the Space does not find it", async () => {
		const ports = inMemoryGatePorts();
		ports.gates.setOpen(SPACE, [openGate(SPACE, "a", 1)]);
		const refused = await refusalOf(
			listOpenGates(ports)({ personId: "person-nobody" }, { spaceId: SPACE }),
		);
		expect(refused?.kind).toBe("not-found");
		expect(ports.gates.asked).toEqual([]);
	});
});

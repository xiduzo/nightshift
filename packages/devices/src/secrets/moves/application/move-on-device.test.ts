import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { inMemoryMovesPorts } from "../adapters/out/in-memory-neighbours";
import { moveOnDevice } from "./move-on-device";
import type { RelaySecretMove } from "./relay-secret-move";

function portsOf() {
	const relayed: RelaySecretMove[] = [];
	return {
		...inMemoryMovesPorts(),
		relayed,
		relay: async (request: RelaySecretMove) => void relayed.push(request),
	};
}

const move = {
	deviceId: "laptop",
	name: "A_TOKEN",
	move: { to: "personal" },
} as const;

describe("moveOnDevice", () => {
	test("on the Home Host itself, the call goes from its own hub", async () => {
		const p = portsOf();
		p.devices.add({ id: "laptop" });
		await moveOnDevice(p)(move);
		expect(p.relayed).toEqual([{ personId: "person-ada", ...move }]);
		expect(p.calls.asked).toEqual([]);
	});

	test("any other goes through the Home Host, which waits for the Device first", async () => {
		const p = portsOf();
		p.calls.setHome({ hostId: "host-1", personId: "person-ada" });
		const asked: unknown[] = [];
		p.calls.addHost("host-1", {
			secrets: {
				moveOnDevice: async (input: unknown) => void asked.push(input),
			},
		});
		await moveOnDevice(p)(move);
		expect(asked).toEqual([move]);
		expect(p.calls.asked).toEqual([{ hostId: "host-1", deadlineMs: 11_000 }]);
		expect(p.relayed).toEqual([]);
	});

	test("a Device of another Person goes to the Home Host too, which refuses it", async () => {
		const p = portsOf();
		p.devices.add({ id: "laptop", ownerId: "person-bob" });
		p.calls.setHome({ hostId: "host-1", personId: "person-ada" });
		p.calls.addHost("host-1", {
			secrets: {
				moveOnDevice: async () => {
					throw new Refusal(
						"not-found",
						"Night Shift does not know that device as one of yours.",
					);
				},
			},
		});
		await expect(moveOnDevice(p)(move)).rejects.toThrow(
			"Night Shift does not know that device as one of yours.",
		);
		expect(p.relayed).toEqual([]);
	});

	test("without a Home Host, no other Device is one of yours", async () => {
		const p = portsOf();
		await expect(moveOnDevice(p)(move)).rejects.toThrow(
			"Night Shift does not know that device as one of yours.",
		);
	});
});

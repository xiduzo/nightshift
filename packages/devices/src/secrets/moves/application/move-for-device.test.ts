import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import type { Caller } from "../../../contract";
import { inMemoryOwnSecrets } from "../adapters/out/in-memory-neighbours";
import { moveForDevice } from "./move-for-device";
import type { RelaySecretMove } from "./relay-secret-move";

/** A Device of a Person that calls this Host home, or a guest Device. */
const callerOf = (personId: string, homeHost: string | null = "host.lan") =>
	({
		personId,
		deviceId: "mac",
		device: { name: "Mac", homeHost },
	}) as unknown as Caller;

function portsOf() {
	const relayed: RelaySecretMove[] = [];
	return {
		relayed,
		relay: async (request: RelaySecretMove) => void relayed.push(request),
		self: { id: "host-device", ownerId: "person-ada" },
		own: inMemoryOwnSecrets(),
	};
}

describe("moveForDevice", () => {
	test("the owner's Mac asks; the move goes to the laptop", async () => {
		const p = portsOf();
		await moveForDevice(p)(callerOf("person-ada"), {
			deviceId: "laptop",
			name: "A_TOKEN",
			move: { to: "personal" },
		});
		expect(p.relayed).toEqual([
			{
				personId: "person-ada",
				deviceId: "laptop",
				name: "A_TOKEN",
				move: { to: "personal" },
			},
		]);
	});

	test("only a Device that calls this Host home asks", async () => {
		const p = portsOf();
		const refused = moveForDevice(p)(callerOf("person-ada", null), {
			deviceId: "laptop",
			name: "A_TOKEN",
			move: { to: "personal" },
		});
		await expect(refused).rejects.toBeInstanceOf(Refusal);
		await expect(refused).rejects.toThrow(
			"Only your home Host moves secrets between your devices.",
		);
		expect(p.relayed).toEqual([]);
	});

	test("a secret on the Home Host computer moves there, for its owner only", async () => {
		const p = portsOf();
		await moveForDevice(p)(callerOf("person-ada"), {
			deviceId: "host-device",
			name: "A_TOKEN",
			move: { to: "removed" },
		});
		expect(p.own.moved).toEqual([["remove", "A_TOKEN", "computer"]]);
		await expect(
			moveForDevice(p)(callerOf("person-bob"), {
				deviceId: "host-device",
				name: "A_TOKEN",
				move: { to: "removed" },
			}),
		).rejects.toThrow("Night Shift does not know that device as one of yours.");
		expect(p.own.moved).toHaveLength(1);
	});

	test("a Home Host that cannot move its secrets says so", async () => {
		const p = { ...portsOf(), own: undefined };
		await expect(
			moveForDevice(p)(callerOf("person-ada"), {
				deviceId: "host-device",
				name: "A_TOKEN",
				move: { to: "personal" },
			}),
		).rejects.toThrow("This device cannot move its secrets.");
	});
});

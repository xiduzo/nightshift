import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { inMemoryMovesPorts } from "../adapters/out/in-memory-neighbours";
import { relaySecretMove } from "./relay-secret-move";

const toPersonal = {
	personId: "person-ada",
	deviceId: "laptop",
	name: "A_TOKEN",
	move: { to: "personal" },
} as const;

describe("relaySecretMove", () => {
	test("the owner's other Device takes one secret call, and the move ends at its result", async () => {
		const p = inMemoryMovesPorts();
		p.devices.add({ id: "laptop", name: "Laptop" });
		p.work.isOnline.add("laptop");
		p.work.replies.set("laptop", [{ kind: "result", value: null }]);
		await relaySecretMove(p)(toPersonal);
		expect(p.work.sent).toEqual([
			{
				deviceId: "laptop",
				request: {
					spaceId: "",
					projectId: "",
					personId: "person-ada",
					runId: null,
					call: { kind: "secret", name: "A_TOKEN", move: { to: "personal" } },
				},
			},
		]);
	});

	test("a Device of another Person, a revoked one or a guest is not one of yours", async () => {
		for (const device of [
			{ id: "laptop", ownerId: "person-bob" },
			{ id: "laptop", revokedAt: 5 },
			{ id: "laptop", homeHost: null },
		]) {
			const p = inMemoryMovesPorts();
			p.devices.add(device);
			p.work.isOnline.add("laptop");
			await expect(relaySecretMove(p)(toPersonal)).rejects.toThrow(
				"Night Shift does not know that device as one of yours.",
			);
			expect(p.work.sent).toEqual([]);
		}
	});

	test("an offline laptop is refused at once, in words for people", async () => {
		const p = inMemoryMovesPorts();
		p.devices.add({ id: "laptop", name: "Laptop" });
		const refused = relaySecretMove(p)(toPersonal);
		await expect(refused).rejects.toBeInstanceOf(Refusal);
		await expect(refused).rejects.toThrow(
			"Laptop is offline. Move it when Laptop is online.",
		);
		expect(p.work.sent).toEqual([]);
	});

	test("the Device's refusal comes back, and no answer is a refusal too", async () => {
		const p = inMemoryMovesPorts();
		p.devices.add({ id: "laptop", name: "Laptop" });
		p.work.isOnline.add("laptop");
		p.work.replies.set("laptop", [
			{ kind: "item", item: {} },
			{
				kind: "error",
				message: "Your role in this Space does not allow this.",
			},
		]);
		await expect(relaySecretMove(p)(toPersonal)).rejects.toThrow(
			"Your role in this Space does not allow this.",
		);
		p.work.replies.set("laptop", []);
		await expect(relaySecretMove(p)(toPersonal)).rejects.toThrow(
			"Laptop did not answer. Check that Laptop is online, then try again.",
		);
	});
});

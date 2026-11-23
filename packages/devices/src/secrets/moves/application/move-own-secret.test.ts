import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import type { WorkReply, WorkRequest } from "../../../contract";
import { inMemoryMovesPorts } from "../adapters/out/in-memory-neighbours";
import { moveOwnSecret } from "./move-own-secret";

const secretCall = (personId: string): WorkRequest => ({
	spaceId: "",
	projectId: "",
	personId,
	runId: null,
	call: { kind: "secret", name: "A_TOKEN", move: { to: "personal" } },
});

async function repliesOf(stream: AsyncGenerator<WorkReply>) {
	const replies: WorkReply[] = [];
	for await (const reply of stream) replies.push(reply);
	return replies;
}

describe("moveOwnSecret", () => {
	test("the laptop serves a secret call from its Home Host only, for its own Person only", async () => {
		const p = inMemoryMovesPorts();
		p.calls.setHome({ hostId: "host-1", personId: "person-ada" });
		const serve = moveOwnSecret(p);
		expect(
			await repliesOf(
				serve({ request: secretCall("person-ada"), hostId: "host-2" }),
			),
		).toEqual([
			{
				kind: "error",
				message: "This device moves its secrets only when its home Host asks.",
			},
		]);
		expect(
			await repliesOf(
				serve({ request: secretCall("person-bob"), hostId: "host-1" }),
			),
		).toEqual([
			{
				kind: "error",
				message: "Only the owner of this device can move its secrets.",
			},
		]);
		expect(p.own.moved).toEqual([]);
		expect(
			await repliesOf(
				serve({ request: secretCall("person-ada"), hostId: "host-1" }),
			),
		).toEqual([{ kind: "result", value: null }]);
		expect(p.own.moved).toEqual([["move", "A_TOKEN", "personal"]]);
	});

	test("the keychain copy stays when the save in the new scope fails", async () => {
		const p = inMemoryMovesPorts();
		p.calls.setHome({ hostId: "host-1", personId: "person-ada" });
		p.own.moveSecret = async () => {
			throw new Refusal("unavailable", "The Host could not be reached.");
		};
		expect(
			await repliesOf(
				moveOwnSecret(p)({
					request: secretCall("person-ada"),
					hostId: "host-1",
				}),
			),
		).toEqual([{ kind: "error", message: "The Host could not be reached." }]);
		expect(p.own.moved).toEqual([]);
	});

	test("a computer without its own secrets moves none", async () => {
		const p = { ...inMemoryMovesPorts(), own: undefined };
		p.calls.setHome({ hostId: "host-1", personId: "person-ada" });
		expect(
			await repliesOf(
				moveOwnSecret(p)({
					request: secretCall("person-ada"),
					hostId: "host-1",
				}),
			),
		).toEqual([
			{ kind: "error", message: "This device cannot move its secrets." },
		]);
	});
});

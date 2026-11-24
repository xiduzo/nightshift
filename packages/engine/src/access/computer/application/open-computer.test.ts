import { describe, expect, test } from "bun:test";
import type { Refusal } from "@nightshift/refusal";
import { NIGHT_SHIFT } from "../../../contract";
import { NotComputerOwner } from "../domain/refusals";
import { openComputer } from "./open-computer";

/** Opening this computer for an actor. */

const open = openComputer({ owner: { id: () => "person-ada" } });

describe("openComputer", () => {
	test("its owner may, through every door, and so may Night Shift", () => {
		for (const door of ["session", "device-key", "command"] as const) {
			open({ personId: "person-ada", door });
		}
		open(NIGHT_SHIFT);
	});

	test("another Person is refused, in words that say who may", () => {
		let refused: unknown = null;
		try {
			open({ personId: "person-bob", door: "session" });
		} catch (error) {
			refused = error;
		}
		expect(refused).toBeInstanceOf(NotComputerOwner);
		expect((refused as Refusal).kind).toBe("forbidden");
		expect((refused as Refusal).message).toBe(
			"Only the owner of this computer can see or change this.",
		);
	});
});

import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { UNREADABLE_REQUEST } from "../../../contract";
import {
	moveHere,
	noAnswerWords,
	offlineWords,
	olderDeviceWords,
	refusalOf,
} from "./secret-moves";

const personal = { to: "personal" } as const;
const removed = { to: "removed" } as const;

describe("the words of a move", () => {
	test("each names the Device, and the verb of the move", () => {
		expect(offlineWords("Laptop", personal)).toBe(
			"Laptop is offline. Move it when Laptop is online.",
		);
		expect(offlineWords("Laptop", removed)).toBe(
			"Laptop is offline. Remove it when Laptop is online.",
		);
		expect(olderDeviceWords("Laptop")).toBe(
			"Update Night Shift on Laptop to move its secrets from here.",
		);
		expect(noAnswerWords("Laptop")).toBe(
			"Laptop did not answer. Check that Laptop is online, then try again.",
		);
	});
});

describe("a reply of the Device with the value", () => {
	test("a result ends the move, another reply reads on", () => {
		expect(refusalOf({ kind: "result", value: null }, "Laptop", personal)).toBe(
			null,
		);
		expect(
			refusalOf({ kind: "item", item: {} }, "Laptop", personal),
		).toBeUndefined();
	});

	test("an error is a refusal in words for people", () => {
		const offline = refusalOf(
			{ kind: "error", message: "gone", offline: true },
			"Laptop",
			personal,
		);
		expect(offline).toEqual(
			new Refusal("unavailable", offlineWords("Laptop", personal)),
		);
		expect(
			refusalOf(
				{ kind: "error", message: UNREADABLE_REQUEST },
				"Laptop",
				personal,
			)?.message,
		).toBe(olderDeviceWords("Laptop"));
		const other = refusalOf(
			{ kind: "error", message: "Your role does not allow this." },
			"Laptop",
			personal,
		);
		expect(other?.kind).toBe("conflict");
		expect(other?.message).toBe("Your role does not allow this.");
	});
});

describe("a move of this computer's own value", () => {
	test("goes to its new scope, for the owner", async () => {
		const calls: unknown[][] = [];
		const own = {
			moveSecret: async (...args: unknown[]) =>
				void calls.push(["move", ...args]),
			moveToProject: async (...args: unknown[]) =>
				void calls.push(["project", ...args]),
			removeSecret: async (...args: unknown[]) =>
				void calls.push(["remove", ...args]),
		};
		await moveHere(own, "person-ada", "A_TOKEN", personal);
		await moveHere(own, "person-ada", "A_TOKEN", {
			to: "project",
			spaceId: "space-1",
			projectId: "project-1",
		});
		await moveHere(own, "person-ada", "A_TOKEN", removed);
		expect(calls).toEqual([
			["move", "A_TOKEN", "personal"],
			[
				"project",
				"A_TOKEN",
				"computer",
				{ spaceId: "space-1", projectId: "project-1" },
				"person-ada",
			],
			["remove", "A_TOKEN", "computer"],
		]);
	});
});

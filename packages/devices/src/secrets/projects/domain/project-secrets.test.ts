import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import {
	atKeeper,
	keptHere,
	keptStepValues,
	memberWhoSaves,
	NOT_A_PROJECT_HERE,
	NOT_A_SPACE_HERE,
	NOT_IN_SPACE,
	NOT_YOUR_STEP,
	namedSecrets,
	OWNER_ONLY,
	settersOf,
	spaceAccess,
} from "./project-secrets";

const rule = {
	savesFlows: (role: string) => role !== "viewer",
	refusalWords: () => "Your role in this Space does not allow this.",
};

describe("the words of the Project secrets", () => {
	test("each is one sentence for people", () => {
		expect(NOT_A_PROJECT_HERE).toBe(
			"This computer does not keep that project. Check that the project is in this Space.",
		);
		expect(NOT_YOUR_STEP).toBe(
			"This device has no step of that run now. Only the device a step runs on gets the project's secrets.",
		);
		expect(NOT_IN_SPACE).toBe(
			"This device takes no part in that Space. Ask an owner of the Space to invite you.",
		);
		expect(NOT_A_SPACE_HERE).toBe(
			"This computer does not keep that Space. Check that you work in the right Space.",
		);
		expect(OWNER_ONLY).toBe(
			"Only the owner of this computer can change this project's secrets here.",
		);
	});
});

describe("who lists or changes a kept secret", () => {
	test("a Member lists; only a role that saves Flows changes", () => {
		expect(() => memberWhoSaves("viewer", false, rule)).not.toThrow();
		expect(() => memberWhoSaves("viewer", true, rule)).toThrow(
			"Your role in this Space does not allow this.",
		);
		expect(() => memberWhoSaves(null, false, rule)).toThrow(NOT_IN_SPACE);
	});

	test("a Space another Host keeps is refused before the role is read", async () => {
		const read: string[] = [];
		const refused = spaceAccess(
			async () => "host-2",
			"space-1",
			{
				roleIn: async () => {
					read.push("role");
					return "owner";
				},
				saves: false,
			},
			rule,
		);
		await expect(refused).rejects.toBeInstanceOf(Refusal);
		await expect(refused).rejects.toThrow(NOT_A_SPACE_HERE);
		expect(read).toEqual([]);
	});

	test("a Project in another Space is refused without asking for its Host", async () => {
		const asked: string[] = [];
		const hostOf = async (spaceId: string) => {
			asked.push(spaceId);
			return null;
		};
		await expect(
			keptHere(async () => "space-2", hostOf, {
				spaceId: "space-1",
				projectId: "project-1",
			}),
		).rejects.toThrow(NOT_A_PROJECT_HERE);
		expect(asked).toEqual([]);
		await keptHere(async () => "space-1", hostOf, {
			spaceId: "space-1",
			projectId: "project-1",
		});
		expect(asked).toEqual(["space-1"]);
	});

	test("through a Host, only the owner of this computer acts", async () => {
		const person = { personId: "person-bob", ownerId: "person-ada" };
		await expect(
			atKeeper(
				"host-1",
				person,
				async () => "here",
				async () => "there",
			),
		).rejects.toThrow(OWNER_ONLY);
		expect(
			await atKeeper(
				null,
				person,
				async () => "here",
				async () => "there",
			),
		).toBe("here");
	});
});

describe("the values of a step and the names of a list", () => {
	test("the Space's value wins over the Project's", async () => {
		expect(
			await keptStepValues(
				{
					project: async () => ({ A: "from-project", B: "from-project" }),
					space: async () => ({ B: "from-space" }),
				},
				{ spaceId: "space-1", projectId: "project-1", runId: "run-1" },
			),
		).toEqual({ A: "from-project", B: "from-space" });
	});

	test("each name with who set it, Someone for a Person not known here", () => {
		const kept = [
			{ name: "A", setAt: 1, setBy: "person-ada" },
			{ name: "B", setAt: 2, setBy: "person-gone" },
			{ name: "C", setAt: 3, setBy: null },
			{ name: "D", setAt: 4, setBy: "person-ada" },
		];
		expect(settersOf(kept)).toEqual(["person-ada", "person-gone"]);
		expect(namedSecrets(kept, new Map([["person-ada", "Ada"]]))).toEqual([
			{ name: "A", setAt: 1, setBy: { id: "person-ada", name: "Ada" } },
			{ name: "B", setAt: 2, setBy: { id: "person-gone", name: "Someone" } },
			{ name: "C", setAt: 3, setBy: null },
			{ name: "D", setAt: 4, setBy: { id: "person-ada", name: "Ada" } },
		]);
	});
});

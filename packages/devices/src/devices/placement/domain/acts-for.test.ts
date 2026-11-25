import { describe, expect, test } from "bun:test";
import { nameOf, ownerIn, runsFor, throughOffers } from "./acts-for";

/** A computer of `self` that knows "ada" as "ada-there" on the Host. */
const known = (self: string | null = "ada") => ({
	people: {
		personInSpace: async (_spaceId: string, id: string | null) =>
			id === "ada" ? "ada-there" : id,
	},
	registry: { selfOwnerId: async () => self },
});

test("another Person's Device takes the work of a Person through its Offers, and the work of nobody as it is", () => {
	expect(throughOffers("ada", "bob")).toBe(true);
	expect(throughOffers("ada", null)).toBe(true);
	expect(throughOffers("ada", "ada")).toBe(false);
	expect(throughOffers(null, "bob")).toBe(false);
});

test("the owner of this computer is the one the Space's Host knows", async () => {
	expect(await ownerIn(known(), "s")).toBe("ada-there");
	expect(await ownerIn(known(null), "s")).toBeNull();
});

describe("a run acts for", () => {
	const person = (startedBy: string | undefined, scheduled = false) =>
		runsFor(known(), "s", { startedBy, scheduled });

	test("its starter as the Host knows them", async () => {
		expect(await person("bob")).toBe("bob");
		expect(await person("ada")).toBe("ada-there");
	});

	test("the Person a schedule names, as it is", async () => {
		expect(await person("ada", true)).toBe("ada");
	});

	test("this computer's owner when nobody is named", async () => {
		expect(await person(undefined)).toBe("ada-there");
		expect(await person(undefined, true)).toBe("ada-there");
		expect(await runsFor(known(null), "s", { scheduled: false })).toBeNull();
	});
});

test("a name is the one known, and none without a Person or a name", async () => {
	const names = async () =>
		new Map([
			["ada", "Ada"],
			["anon", ""],
		]);
	expect(await nameOf(names, "ada")).toBe("Ada");
	expect(await nameOf(names, "anon")).toBeUndefined();
	expect(await nameOf(names, "bob")).toBeUndefined();
	expect(await nameOf(names, null)).toBeUndefined();
});

import { expect, test } from "bun:test";
import { listedThroughOffers, throughOffers } from "./through-offers";

test("another Person's Device takes the work of a Person through its Offers, and the work of nobody as it is", () => {
	expect(throughOffers("ada", "bob")).toBe(true);
	expect(throughOffers("ada", null)).toBe(true);
	expect(throughOffers("ada", "ada")).toBe(false);
	expect(throughOffers(null, "bob")).toBe(false);
});

test("a list has a Device as another Person's when it names its Offers, also none", () => {
	expect(listedThroughOffers({ offers: ["coder"] })).toBe(true);
	expect(listedThroughOffers({ offers: [] })).toBe(true);
	expect(listedThroughOffers({})).toBe(false);
});

import { describe, expect, test } from "bun:test";
import {
	addressDraftFrom,
	addressFrom,
	addressProblems,
	sameAddress,
} from "./model-address-draft";

describe("the address fields of a Model Profile", () => {
	test("an empty base URL is no address; the rest is left out when empty", () => {
		expect(addressFrom(addressDraftFrom(undefined))).toBeUndefined();
		expect(
			addressFrom({
				...addressDraftFrom(undefined),
				baseUrl: " http://openjev:8080 ",
			}),
		).toEqual({ baseUrl: "http://openjev:8080" });
	});

	test("a saved address comes back as it was", () => {
		const address = {
			baseUrl: "http://gpu-box:11434",
			apiKey: "PROXY_KEY",
			headers: { "X-Team": "night" },
		};
		const draft = addressDraftFrom(address);
		expect(addressFrom(draft)).toEqual(address);
		expect(sameAddress(draft, addressDraftFrom(address))).toBe(true);
	});

	test("a decider without a default needs a base URL; a key is a secret's name", () => {
		const empty = addressDraftFrom(undefined);
		expect(addressProblems(empty, true)).toEqual({
			baseUrl: "Add the address of its server.",
		});
		expect(addressProblems(empty, false)).toEqual({});
		expect(
			addressProblems(
				{ ...empty, baseUrl: "openjev:8080", apiKey: "sk-123 abc" },
				false,
			),
		).toEqual({
			baseUrl:
				"Use an http:// or https:// address, such as http://127.0.0.1:8080.",
			apiKey:
				"Use the name of a secret: letters, digits and _, starting with a letter or _.",
		});
	});
});

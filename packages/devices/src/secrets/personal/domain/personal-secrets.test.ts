import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { NOT_YOUR_HOME_HOST, ownerOf } from "./personal-secrets";

describe("whose Personal secrets a Device uses", () => {
	test("its own Person's, when this is its home Host", () => {
		expect(
			ownerOf({ personId: "person-ada", device: { homeHost: "host.lan" } }),
		).toBe("person-ada");
	});

	test("none, for a Device that joined as a guest", () => {
		const refused = () =>
			ownerOf({ personId: "person-ada", device: { homeHost: null } });
		expect(refused).toThrow(Refusal);
		expect(refused).toThrow(NOT_YOUR_HOME_HOST);
		expect(NOT_YOUR_HOME_HOST).toBe(
			"This computer keeps no Personal secrets for you. They stay with your home Host.",
		);
	});
});

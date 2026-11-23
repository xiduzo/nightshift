import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { NOT_A_HOST } from "../../../contract";
import { requireHost } from "./host";

describe("requireHost", () => {
	test("refuses while Be a Host is off, in those words", () => {
		expect(() => requireHost(false)).toThrow(Refusal);
		expect(() => requireHost(false)).toThrow(NOT_A_HOST);
		expect(() => requireHost(true)).not.toThrow();
	});
});

import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import {
	adoptedTwin,
	refuseOnlineTwin,
	refuseSelfPair,
	twinMachine,
} from "./pairing-rules";
import { SELF_PAIR, twinOnlineWords } from "./words";

describe("pairing rules", () => {
	test("a computer cannot pair with itself", () => {
		expect(() => refuseSelfPair("host-a", "host-a")).toThrow(Refusal);
		expect(() => refuseSelfPair("host-a", "host-a")).toThrow(SELF_PAIR);
		expect(() => refuseSelfPair("host-a", "laptop")).not.toThrow();
	});

	test("a guest pairing never uses the computer fingerprint", () => {
		expect(twinMachine(true, "abc")).toBe("abc");
		expect(twinMachine(false, "abc")).toBeUndefined();
		expect(twinMachine(true, undefined)).toBeUndefined();
	});

	test("the Host does not adopt its own row as the twin", () => {
		expect(adoptedTwin({ id: "first" }, "host-a")?.id).toBe("first");
		expect(adoptedTwin({ id: "host-a" }, "host-a")).toBeNull();
		expect(adoptedTwin(null, "host-a")).toBeNull();
	});

	test("while the twin is linked, pairing is refused in those words", () => {
		expect(() =>
			refuseOnlineTwin({ id: "first", name: "LE2316", online: true }, "Studio"),
		).toThrow(twinOnlineWords("Studio", "LE2316"));
		expect(() =>
			refuseOnlineTwin(
				{ id: "first", name: "LE2316", online: false },
				"Studio",
			),
		).not.toThrow();
		expect(() => refuseOnlineTwin(null, "Studio")).not.toThrow();
	});
});

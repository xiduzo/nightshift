import { describe, expect, test } from "bun:test";
import { flowUnreadWords } from "./flow-unread";

describe("flowUnreadWords", () => {
	test("a run whose flow reads says nothing", () => {
		expect(flowUnreadWords({})).toBeNull();
	});

	test("an older run says what a person can still do with it", () => {
		expect(flowUnreadWords({ flowUnread: "older" })).toEqual({
			title: "This run is from an older version of Night Shift",
			body: "You can read its steps and costs. You cannot see its flow or run it again.",
		});
	});

	test("a newer run asks for an update, and a broken one says so", () => {
		expect(flowUnreadWords({ flowUnread: "newer" })?.body).toBe(
			"Update Night Shift to see its flow.",
		);
		expect(flowUnreadWords({ flowUnread: "invalid" })?.title).toBe(
			"Night Shift cannot read the flow of this run",
		);
	});
});

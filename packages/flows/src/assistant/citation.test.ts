import { describe, expect, test } from "bun:test";
import { citedStepId, stepCitation } from "./citation";

describe("a step citation", () => {
	test("is a fragment link that names the step", () => {
		expect(stepCitation("critic", "s-1")).toBe("[critic](#step-s-1)");
	});

	test("drops brackets from its label", () => {
		expect(stepCitation("[x]", "s1")).toBe("[x](#step-s1)");
	});

	test("reads back the step id", () => {
		const id = "1f0c2a4e-8b5d-4c3e-9a7f-0d1e2f3a4b5c";
		const href = /\]\((.*)\)$/.exec(stepCitation("critic", id))?.[1];
		expect(citedStepId(href)).toBe(id);
	});

	test("cites nothing for another link", () => {
		expect(citedStepId(undefined)).toBeUndefined();
		expect(citedStepId("https://example.com")).toBeUndefined();
		expect(citedStepId("#step-")).toBeUndefined();
		expect(citedStepId("#steps")).toBeUndefined();
		expect(citedStepId("#step-a b")).toBeUndefined();
		expect(citedStepId("#step-<script>")).toBeUndefined();
	});
});

import { describe, expect, test } from "bun:test";
import type { FlowInputDef } from "@nightshift/flows";

import { resolveInputs } from "./inputs";

const strict = { what: "The flow", jsonText: "strict" } as const;
const lenient = { what: "The flow", jsonText: "lenient" } as const;

describe("resolveInputs", () => {
	test("reads a number from text and a number default", () => {
		const inputs: FlowInputDef[] = [
			{ name: "minutes", type: "number" },
			{ name: "rounds", type: "number", default: " 3 " },
			{ name: "limit", type: "number" },
		];
		expect(resolveInputs(inputs, { minutes: "45" }, strict)).toEqual({
			minutes: 45,
			rounds: 3,
			limit: null,
		});
	});

	test("refuses text that is not a number, unless lenient", () => {
		const inputs: FlowInputDef[] = [{ name: "minutes", type: "number" }];
		expect(() => resolveInputs(inputs, { minutes: "soon" }, strict)).toThrow(
			'The value of input "minutes" is not a number.',
		);
		expect(resolveInputs(inputs, { minutes: "soon" }, lenient)).toEqual({
			minutes: "soon",
		});
	});

	test("reads a boolean from true, yes and their opposites", () => {
		const inputs: FlowInputDef[] = [
			{ name: "a", type: "boolean" },
			{ name: "b", type: "boolean" },
			{ name: "c", type: "boolean", default: "yes" },
			{ name: "d", type: "boolean" },
		];
		expect(resolveInputs(inputs, { a: true, b: "No" }, strict)).toEqual({
			a: true,
			b: false,
			c: true,
			d: false,
		});
		expect(() => resolveInputs(inputs, { a: "maybe" }, strict)).toThrow(
			"is not true or false.",
		);
	});

	test("holds a choice to its options", () => {
		const inputs: FlowInputDef[] = [
			{ name: "tour", type: "choice", options: ["money", "museum"] },
		];
		expect(resolveInputs(inputs, { tour: "museum" }, strict)).toEqual({
			tour: "museum",
		});
		expect(resolveInputs(inputs, {}, strict)).toEqual({ tour: "" });
		expect(() => resolveInputs(inputs, { tour: "zoo" }, strict)).toThrow(
			"is not one of: money, museum.",
		);
	});

	test("refuses a default that does not fit the type", () => {
		const inputs: FlowInputDef[] = [
			{ name: "minutes", type: "number", default: "lots" },
		];
		expect(() => resolveInputs(inputs, {}, strict)).toThrow(
			'The default of input "minutes" is not a number.',
		);
	});

	test("keeps text and json as before", () => {
		const inputs: FlowInputDef[] = [
			{ name: "focus", type: "text", default: "the login " },
			{ name: "item", type: "json" },
		];
		expect(resolveInputs(inputs, { item: '{"a":1}' }, strict)).toEqual({
			focus: "the login ",
			item: { a: 1 },
		});
	});
});

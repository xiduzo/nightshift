import { describe, expect, test } from "bun:test";
import type { FlowInputDef } from "@nightshift/flows";

import {
	filledInputs,
	inputProblem,
	isOptional,
	missingInputs,
} from "./inputs";

const text = (name: string, extra: Partial<FlowInputDef> = {}) =>
	({ name, type: "text", ...extra }) as FlowInputDef;
const json = (name: string, extra: Partial<FlowInputDef> = {}) =>
	({ name, type: "json", ...extra }) as FlowInputDef;

describe("the inputs of a flow at its start", () => {
	test("a required input without a value or a default is missing", () => {
		const inputs = [
			text("ticket", { required: true }),
			text("branch", { required: true, default: "main" }),
			text("note"),
		];
		expect(missingInputs(inputs, {}).map((i) => i.name)).toEqual(["ticket"]);
		expect(missingInputs(inputs, { ticket: "  " }).map((i) => i.name)).toEqual([
			"ticket",
		]);
		expect(missingInputs(inputs, { ticket: "NS-1" })).toEqual([]);
	});

	test("JSON that is not valid has a problem, empty JSON does not", () => {
		expect(inputProblem(json("item"), "{")).not.toBeNull();
		expect(inputProblem(json("item"), '{"a": 1}')).toBeNull();
		expect(inputProblem(json("item"), "  ")).toBeNull();
		expect(inputProblem(text("note"), "{")).toBeNull();
	});

	test("sends only what was filled in: text trimmed, JSON parsed", () => {
		expect(
			filledInputs([text("ticket"), json("item"), text("note")], {
				ticket: " NS-1 ",
				item: '{"title": "Fix"}',
				note: "",
			}),
		).toEqual({ ticket: "NS-1", item: { title: "Fix" } });
	});

	test("a number that is not valid has a problem", () => {
		const minutes = { name: "minutes", type: "number" } as FlowInputDef;
		expect(inputProblem(minutes, "soon")).not.toBeNull();
		expect(inputProblem(minutes, " 45 ")).toBeNull();
	});

	test("sends numbers, booleans and choices as their type", () => {
		const inputs = [
			{ name: "minutes", type: "number" },
			{ name: "check", type: "boolean" },
			{ name: "tour", type: "choice", options: ["money"] },
		] as FlowInputDef[];
		expect(
			filledInputs(inputs, { minutes: "45", check: "false", tour: "money" }),
		).toEqual({ minutes: 45, check: false, tour: "money" });
	});

	test("an input is optional without required, or with a default", () => {
		expect(isOptional(text("note"))).toBe(true);
		expect(isOptional(text("ticket", { required: true }))).toBe(false);
		expect(
			isOptional(text("branch", { required: true, default: "main" })),
		).toBe(true);
		expect(isOptional({ type: "boolean" })).toBe(false);
	});

	test("a boolean is never missing", () => {
		const check = {
			name: "check",
			type: "boolean",
			required: true,
		} as FlowInputDef;
		expect(missingInputs([check], {})).toEqual([]);
	});
});

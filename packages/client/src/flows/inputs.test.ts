import { describe, expect, test } from "bun:test";
import type { FlowInputDef } from "@nightshift/flows";

import { filledInputs, jsonProblem, missingInputs } from "./inputs";

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
		expect(jsonProblem(json("item"), "{")).not.toBeNull();
		expect(jsonProblem(json("item"), '{"a": 1}')).toBeNull();
		expect(jsonProblem(json("item"), "  ")).toBeNull();
		expect(jsonProblem(text("note"), "{")).toBeNull();
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
});

import { describe, expect, test } from "bun:test";
import type { AskForm } from "@nightshift/flows";
import {
	askAnswerOf,
	askFormFields,
	askOptions,
	askStartValues,
	phoneCanAnswer,
} from "./ask";

const form: AskForm = {
	schema: {
		type: "object",
		required: ["variant"],
		properties: {
			variant: { type: "string", enum: ["calm", "bold"] },
			tasks: { type: "array", items: { type: "string", enum: ["t1", "t2"] } },
			works: { type: "boolean" },
			count: { type: "integer" },
			comment: { type: "string" },
			extra: { type: "object" },
		},
	},
	choices: {
		field: "variant",
		items: [
			{ name: "calm", label: "Calm", description: "Soft colours" },
			{ name: "bold", label: "Bold" },
		],
	},
};

describe("the form of an Ask on a screen", () => {
	test("a choice of the run's choices shows their labels, another choice its enum", () => {
		const [variant, tasks] = askFormFields(form);
		if (!variant || !tasks) throw new Error("The form has no fields.");
		expect(askOptions(form, variant).map((option) => option.label)).toEqual([
			"Calm",
			"Bold",
		]);
		expect(askOptions(form, tasks)).toEqual([
			{ name: "t1", label: "t1" },
			{ name: "t2", label: "t2" },
		]);
	});

	test("the form starts with the pre-filled data where it fits each field", () => {
		expect(
			askStartValues({
				...form,
				prefill: {
					variant: "loud",
					tasks: ["t2", "t9"],
					works: true,
					count: 3,
					comment: "ok",
					extra: { a: 1 },
				},
			}),
		).toEqual({
			variant: "",
			tasks: ["t2"],
			works: true,
			count: "3",
			comment: "ok",
			extra: '{\n  "a": 1\n}',
		});
		expect(askStartValues(form)).toMatchObject({ works: false, tasks: [] });
	});

	test("an answer sends the filled-in fields as data, with numbers and JSON read", () => {
		expect(
			askAnswerOf(form, {
				variant: "bold",
				tasks: ["t1"],
				works: false,
				count: "4",
				comment: " ",
				extra: '{"a": 1}',
			}),
		).toEqual({
			data: {
				variant: "bold",
				tasks: ["t1"],
				works: false,
				count: 4,
				extra: { a: 1 },
			},
		});
	});

	test("an answer is not ready while a required field is empty or a value is not valid", () => {
		expect(askAnswerOf(form, { variant: "" })).toEqual({
			problem: '"variant" needs an answer.',
		});
		expect(askAnswerOf(form, { variant: "calm", count: "many" })).toEqual({
			problem: '"count" must be a number.',
		});
		expect(askAnswerOf(form, { variant: "calm", count: "1.5" })).toEqual({
			problem: '"count" must be a whole number.',
		});
		expect(askAnswerOf(form, { variant: "calm", extra: "{" })).toEqual({
			problem: 'Check the format of "extra".',
		});
	});

	test("the phone answers a form of text, choices, switches and numbers only", () => {
		expect(phoneCanAnswer(form)).toBe(false);
		const { extra: _extra, ...simple } = form.schema.properties as Record<
			string,
			unknown
		>;
		expect(
			phoneCanAnswer({
				...form,
				schema: { ...form.schema, properties: simple } as typeof form.schema,
			}),
		).toBe(true);
	});
});

import { describe, expect, test } from "bun:test";
import { askFields, formDataProblem, isSimpleForm, withChoices } from "./ask";

const schema = {
	type: "object",
	required: ["variant", "ok"],
	properties: {
		variant: { type: "string", enum: ["a", "b"], title: "Variant" },
		tasks: { type: "array", items: { enum: ["t1", "t2"] } },
		ok: { type: "boolean", description: "It works" },
		count: { type: "integer" },
		note: { type: ["string", "null"] },
		extra: { type: "object" },
	},
};

describe("the form of an Ask", () => {
	test("each field of the schema has a kind, a label and a hint", () => {
		expect(
			askFields(schema).map(({ name, kind, label, hint, required }) => ({
				name,
				kind,
				label,
				hint,
				required,
			})),
		).toEqual([
			{
				name: "variant",
				kind: "choice",
				label: "Variant",
				hint: undefined,
				required: true,
			},
			{
				name: "tasks",
				kind: "choices",
				label: "tasks",
				hint: undefined,
				required: false,
			},
			{
				name: "ok",
				kind: "switch",
				label: "ok",
				hint: "It works",
				required: true,
			},
			{
				name: "count",
				kind: "number",
				label: "count",
				hint: undefined,
				required: false,
			},
			{
				name: "note",
				kind: "text",
				label: "note",
				hint: undefined,
				required: false,
			},
			{
				name: "extra",
				kind: "other",
				label: "extra",
				hint: undefined,
				required: false,
			},
		]);
	});

	test("a form is simple when every field is text, a choice, a switch or a number", () => {
		expect(isSimpleForm(schema)).toBe(false);
		const { extra: _extra, ...simple } = schema.properties;
		expect(isSimpleForm({ ...schema, properties: simple })).toBe(true);
		expect(isSimpleForm({ type: "object" })).toBe(false);
	});

	test("the run's choices become the enum of their field", () => {
		const own = {
			type: "object",
			properties: {
				pick: { type: "string" },
				picks: { type: "array", items: { type: "string" } },
			},
		};
		const one = withChoices(own, "pick", ["x", "y"]);
		expect(askFields(one)[0]).toMatchObject({
			kind: "choice",
			options: ["x", "y"],
		});
		const several = withChoices(own, "picks", ["x"]);
		expect(askFields(several)[1]).toMatchObject({
			kind: "choices",
			options: ["x"],
		});
	});

	test("data fits the form when it has every required field of the right kind", () => {
		expect(formDataProblem(schema, { variant: "a", ok: true })).toBeNull();
		expect(formDataProblem(schema, { variant: "c", ok: true })).toBe(
			'"Variant" must be one of: a, b.',
		);
		expect(formDataProblem(schema, { variant: "a" })).toBe(
			'"ok" needs an answer.',
		);
		expect(
			formDataProblem(schema, { variant: "a", ok: true, count: 1.5 }),
		).toBe('"count" must be a whole number.');
		expect(
			formDataProblem(schema, { variant: "a", ok: true, tasks: ["t3"] }),
		).toBe('"tasks" must be a list of: t1, t2.');
		expect(formDataProblem(schema, [])).toBe("The answer must be an object.");
	});
});

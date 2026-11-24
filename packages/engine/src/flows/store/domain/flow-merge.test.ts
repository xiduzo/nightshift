import { expect, test } from "bun:test";
import { flowNameSchema } from "@nightshift/flows";
import { apartNames, withCalls } from "./flow-merge";

test("names that keep apart are valid, differ, and take none that is there", () => {
	const long = `${"a".repeat(50)}-bcdefghi`;
	const names = apartNames(
		["x", long, `${long}j`],
		"12345678",
		new Set(["x-12345678"]),
	);
	const taken = Object.values(names);
	expect(new Set(taken).size).toBe(3);
	expect(names.x).toBe("x-12345678-2");
	expect(names[long]).toBe(`${"a".repeat(50)}-12345678`);
	for (const name of taken)
		expect(flowNameSchema.safeParse(name).success).toBe(true);
});

test("only the flows a Call names change", () => {
	const flows = { build: "build-1" };
	const agent = { type: "agent", flow: "build", cascade: [{ flow: "build" }] };
	expect(withCalls(agent, flows)).toBe(agent);
	expect(
		withCalls(
			{
				type: "call",
				flow: "kit:a/b",
				cascade: [{ flow: "build" }, { by: "person" }, "odd"],
			},
			flows,
		),
	).toEqual({
		type: "call",
		flow: "kit:a/b",
		cascade: [{ flow: "build-1" }, { by: "person" }, "odd"],
	});
	expect(
		Object.keys(
			(
				withCalls({ type: "call", cascade: [{}] }, flows) as {
					cascade: object[];
				}
			).cascade[0] as object,
		),
	).toEqual([]);
});

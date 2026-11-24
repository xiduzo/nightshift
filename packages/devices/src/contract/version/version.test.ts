import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { PROTOCOL_VERSION } from "@nightshift/refusal";
import { getEventIteratorSchemaDetails } from "@orpc/contract";
import { z } from "zod";
import { hostContract } from "../host-contract";
import { refusalDataSchema } from "../procedure";
import { secretRequestSchema, workRequestSchema } from "../work";
import {
	deviceVersionOf,
	documentToken,
	hostVersionOf,
	keyOfDocumentToken,
	VERSION_HEADER,
} from "./version";

/**
 * The number goes up with the shape (ADR 45). A shape that is not the one of
 * the last line needs a new number: raise `PROTOCOL_VERSION` by one, and add
 * a line. Never edit the line of a version that an install runs: two shapes
 * would have one number.
 */
const SHAPES: Record<string, string> = {
	1: "2a36cd042c9413bc",
};

/** A schema as plain data, with its keys in order. Null: the procedure has none. */
function described(schema: unknown): unknown {
	if (schema === undefined) return null;
	const events = getEventIteratorSchemaDetails(schema as never);
	if (events) return { events: described(events.yields) };
	return sorted(
		z.toJSONSchema(schema as z.ZodType, {
			unrepresentable: "any",
			io: "input",
		}),
	);
}

function sorted(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sorted);
	if (typeof value !== "object" || value === null) return value;
	return Object.fromEntries(
		Object.entries(value)
			.sort(([a], [b]) => (a < b ? -1 : 1))
			.map(([key, item]) => [key, sorted(item)]),
	);
}

/** Everything a Device and its Host say to each other, as plain data. */
function shape(): unknown {
	return {
		procedures: Object.entries(hostContract).flatMap(([group, entries]) =>
			Object.entries(entries).map(([name, procedure]) => {
				const { meta, errorMap, inputSchema, outputSchema } =
					procedure["~orpc"];
				return {
					path: `${group}.${name}`,
					key: meta.key ?? null,
					errors: Object.entries(
						errorMap as Record<string, { status?: number; data?: unknown }>,
					).map(([code, error]) => [
						code,
						error.status ?? null,
						described(error.data),
					]),
					input: described(inputSchema),
					output: described(outputSchema),
				};
			}),
		),
		// What a call carries loosely, and the other side checks.
		work: described(workRequestSchema),
		secret: described(secretRequestSchema),
		refusal: described(refusalDataSchema),
		header: VERSION_HEADER,
		token: documentToken("key").replace(String(PROTOCOL_VERSION), "N"),
	};
}

const hash = createHash("sha256")
	.update(JSON.stringify(shape()))
	.digest("hex")
	.slice(0, 16);

describe("the number of the peer protocol", () => {
	test("names the shape of the contract now: a changed shape needs a new number and a new line", () => {
		const named = SHAPES[String(PROTOCOL_VERSION)];
		expect(
			{ version: PROTOCOL_VERSION, shape: hash },
			"The peer protocol changed. Raise PROTOCOL_VERSION (packages/refusal/src/version.ts) by one, and add a line to SHAPES.",
		).toEqual({ version: PROTOCOL_VERSION, shape: named ?? "" });
	});

	test("is the last line, the lines count up by one, and no two versions have one shape", () => {
		const versions = Object.keys(SHAPES).map(Number);
		expect(versions).toEqual(versions.map((_, i) => i + 1));
		expect(versions.at(-1)).toBe(PROTOCOL_VERSION);
		expect(new Set(Object.values(SHAPES)).size).toBe(versions.length);
	});

	test("reads every procedure: none is described as anything at all", () => {
		const { procedures } = shape() as {
			procedures: { path: string; input: unknown; output: unknown }[];
		};
		expect(procedures.length).toBeGreaterThan(45);
		for (const { path, input, output } of procedures) {
			expect(output, path).not.toBeNull();
			if (input !== null) expect(JSON.stringify(input), path).not.toBe("{}");
		}
		const stream = procedures.find((p) => p.path === "sync.stream");
		expect(JSON.stringify(stream?.output)).toContain("runs");
	});
});

describe("the version a Device says", () => {
	test("is a number in the header, and anything else is none", () => {
		const said = (value: string) =>
			deviceVersionOf(new Headers({ [VERSION_HEADER]: value }));
		expect(said("12")).toBe(12);
		for (const value of ["", "x", "1.5", "-1", "1e3", "9999999999"]) {
			expect(said(value)).toBeNull();
		}
		expect(deviceVersionOf(new Headers())).toBeNull();
	});

	test("goes with the key to the document channel, and only this version's key is read", () => {
		expect(keyOfDocumentToken(documentToken("nsd_a-b_c"))).toBe("nsd_a-b_c");
		for (const token of [
			"nsd_a",
			"nsd_a@",
			`nsd_a@${PROTOCOL_VERSION + 1}`,
			`nsd_a@${PROTOCOL_VERSION - 1}`,
		]) {
			expect(keyOfDocumentToken(token)).toBeNull();
		}
	});

	test("a refusal of it says how the Host compares, and no other data does", () => {
		expect(hostVersionOf({ device: "older" })).toBe("newer");
		expect(hostVersionOf({ device: "newer" })).toBe("older");
		for (const data of [undefined, null, {}, { device: "x" }, "older"]) {
			expect(hostVersionOf(data)).toBeNull();
		}
	});
});

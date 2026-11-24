import { describe, expect, test } from "bun:test";
import { GateClosedError, NeedsApp } from "@nightshift/engine";
import { readable } from "./readable";

describe("the refusals of an answer, as a Device reads them", () => {
	// Decision 77 of the hexagon series: a Host that walks a run refuses an
	// answer from the lock screen the rule does not let through. An older
	// Device knows the code: BAD_REQUEST, with the words and the kind.
	test("an answer that needs the app is a BAD_REQUEST of kind forbidden, with its words", () => {
		expect(readable(new NeedsApp(), ["sync", "command"])).toMatchObject({
			code: "BAD_REQUEST",
			message: "Open this Gate in Night Shift to answer it.",
			data: { kind: "forbidden" },
		});
	});

	test("an answer to a Gate that does not wait is a BAD_REQUEST of kind conflict, with its words", () => {
		expect(
			readable(new GateClosedError("This Gate does not wait anymore."), [
				"sync",
				"command",
			]),
		).toMatchObject({
			code: "BAD_REQUEST",
			message: "This Gate does not wait anymore.",
			data: { kind: "conflict" },
		});
	});
});

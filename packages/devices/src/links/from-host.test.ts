import { describe, expect, test } from "bun:test";
import { HostUnreachableError } from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import { ORPCError } from "@orpc/client";
import { fromHost, NOT_PAIRED } from "./from-host";

/**
 * A Host answers a call of this computer about its Device key, not about
 * the person's session here. So its errors reach the person in this
 * computer's words: never a 401 that sends them to sign in, and the kind
 * of a refusal as the Host meant it.
 */

describe("the error a person gets for a Host's error", () => {
	test("a key the Host no longer knows asks to pair this computer again", () => {
		for (const error of [
			new ORPCError("UNAUTHORIZED", {
				message: "This device has no access here. Pair it again.",
			}),
			new ORPCError("BAD_REQUEST", {
				message: "Sign in.",
				data: { kind: "signed-out" },
			}),
		]) {
			const refusal = fromHost(error);
			expect(refusal).toBeInstanceOf(Refusal);
			expect(refusal).toMatchObject({ kind: "conflict", message: NOT_PAIRED });
		}
	});

	test("a refusal keeps the Host's words and the kind it sends", () => {
		const refusal = fromHost(
			new ORPCError("BAD_REQUEST", {
				message: "This run does not exist.",
				data: { kind: "not-found" },
			}),
		);
		expect(refusal).toBeInstanceOf(Refusal);
		expect(refusal).toMatchObject({
			kind: "not-found",
			message: "This run does not exist.",
		});
	});

	test("a refusal of an older Host has no kind: it is not valid", () => {
		expect(
			fromHost(new ORPCError("BAD_REQUEST", { message: "Not like this." })),
		).toMatchObject({ kind: "invalid", message: "Not like this." });
		expect(
			fromHost(
				new ORPCError("BAD_REQUEST", {
					message: "Not like this.",
					data: { kind: "a kind from later" },
				}),
			),
		).toMatchObject({ kind: "invalid" });
	});

	test("the Host's other codes are refusals of their kind", () => {
		expect(
			fromHost(new ORPCError("FORBIDDEN", { message: "Your role…" })),
		).toMatchObject({ kind: "forbidden", message: "Your role…" });
		expect(
			fromHost(new ORPCError("CONFLICT", { message: "Not yet." })),
		).toMatchObject({ kind: "conflict", message: "Not yet." });
		expect(
			fromHost(new ORPCError("NOT_FOUND", { message: "No such phone." })),
		).toMatchObject({ kind: "not-found" });
		expect(
			fromHost(new ORPCError("HOST_UNREACHABLE", { status: 503 })),
		).toBeInstanceOf(HostUnreachableError);
	});

	test("a failure of the Host is a failure here: plain words, the details in the log", () => {
		const failure = new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "Something went wrong.",
		});
		const error = fromHost(failure);
		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(Refusal);
		expect((error as Error).cause).toBe(failure);
	});

	test("an error that is not the Host's passes on as it is", () => {
		const lost = new TypeError("The network connection was lost.");
		expect(fromHost(lost)).toBe(lost);
	});
});

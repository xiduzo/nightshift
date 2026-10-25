import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { APIError } from "better-auth/api";

import { refusalOf } from "./auth-refusals";

describe("what Better Auth refuses", () => {
	test("a code it uses gets Night Shift's words and its kind", () => {
		const error = new APIError("BAD_REQUEST", {
			code: "USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION",
			message: "User is already invited to this organization",
		});
		const refusal = refusalOf(error);
		expect(refusal).toBeInstanceOf(Refusal);
		expect(refusal).toMatchObject({
			kind: "conflict",
			message: "This person has an invitation to this Space already.",
		});
		expect(String((refusal as Refusal).message)).not.toContain("organization");
	});

	test("a refusal Night Shift wrote in a hook keeps its own words", () => {
		const own = new Refusal("forbidden", "Nobody can join a personal Space.");
		const error = new APIError("FORBIDDEN", {
			message: own.message,
			cause: own,
		});
		expect(refusalOf(error)).toBe(own);
	});

	test("any other refusal of a role is not allowed, in plain words", () => {
		const error = new APIError("FORBIDDEN", {
			code: "YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER",
			message: "You are not allowed to update this member",
		});
		expect(refusalOf(error)).toMatchObject({
			kind: "forbidden",
			message: "Your role in this Space does not allow this.",
		});
	});

	test("anything else stays a failure", () => {
		const failure = new Error("SQLITE_BUSY: database is locked");
		expect(refusalOf(failure)).toBe(failure);
		const unknown = new APIError("INTERNAL_SERVER_ERROR", { message: "boom" });
		expect(refusalOf(unknown)).toBe(unknown);
	});
});

import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { emailTaken, loginEmail } from "./login";

describe("loginEmail", () => {
	test("is the email in lower case, without spaces around it", () => {
		expect(
			loginEmail({ email: " Ada@Example.com ", password: "a-long-password" }),
		).toBe("ada@example.com");
	});

	test("refuses an email that is not an address, and a short password", () => {
		expect(() =>
			loginEmail({ email: "ada", password: "a-long-password" }),
		).toThrow(new Refusal("invalid", "ada is not an email address."));
		expect(() =>
			loginEmail({ email: "ada@example.com", password: "short" }),
		).toThrow(
			new Refusal("invalid", "Use a password of at least 8 characters."),
		);
	});
});

describe("emailTaken", () => {
	test("names the email", () => {
		const refusal = emailTaken("bob@example.com");
		expect(refusal.kind).toBe("conflict");
		expect(refusal.message).toBe(
			"Another Person here signs in with bob@example.com.",
		);
	});
});

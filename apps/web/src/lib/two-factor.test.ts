import { describe, expect, test } from "bun:test";

import { authErrorMessage, backupCodesFile, setupKeyOf } from "./two-factor";

describe("two-factor in the browser", () => {
	test("the setup key comes from the link, in groups of four", () => {
		expect(
			setupKeyOf(
				"otpauth://totp/Night%20Shift:ada%40example.com?secret=GEZDGNBVGY3TQOJQ&issuer=Night%20Shift",
			),
		).toBe("GEZD GNBV GY3T QOJQ");
		expect(setupKeyOf("not a link")).toBe("");
	});

	test("errors in plain words", () => {
		expect(authErrorMessage({ code: "INVALID_CODE", status: 401 })).toBe(
			"This code is not correct. Enter the code your app shows now.",
		);
		expect(
			authErrorMessage({ status: 429, message: "Too many requests" }),
		).toBe("Too many tries. Wait a minute, then try again.");
		expect(authErrorMessage({ code: "SOMETHING_NEW" }, "Not saved.")).toBe(
			"Not saved.",
		);
		expect(authErrorMessage(null)).toBe("Something went wrong. Try again.");
	});

	test("the backup codes file has one code per line", () => {
		const file = backupCodesFile(
			["aaaaa-11111", "bbbbb-22222"],
			"ada@example.com",
		);
		expect(file.split("\n")).toContain("aaaaa-11111");
		expect(file.split("\n")).toContain("bbbbb-22222");
	});
});

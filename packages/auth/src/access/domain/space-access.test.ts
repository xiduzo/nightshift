import { describe, expect, test } from "bun:test";
import { SIGNED_OUT, spaceAccess } from "./space-access";

const ADA = { user: { id: "ada" } };
const IN = { allowed: true } as const;

describe("spaceAccess", () => {
	test("no session, or no Space: sign in", () => {
		expect(
			spaceAccess({ session: null, spaceId: "mine", hostAccess: IN }),
		).toBe(SIGNED_OUT);
		expect(spaceAccess({ session: ADA, spaceId: null, hostAccess: IN })).toBe(
			SIGNED_OUT,
		);
	});

	test("a session the Host does not let in gets the Host's refusal, as 403", () => {
		expect(
			spaceAccess({
				session: ADA,
				spaceId: "mine",
				hostAccess: {
					allowed: false,
					code: "TWO_FACTOR_REQUIRED",
					message: "Turn it on.",
				},
			}),
		).toEqual({
			allowed: false,
			code: "TWO_FACTOR_REQUIRED",
			message: "Turn it on.",
			status: 403,
		});
	});

	test("a session in a Space works there", () => {
		expect(
			spaceAccess({ session: ADA, spaceId: "mine", hostAccess: IN }),
		).toEqual({ allowed: true, session: ADA, spaceId: "mine" });
	});
});

import { describe, expect, test } from "bun:test";
import { finishMembership } from "./finish-membership";

describe("finishMembership", () => {
	test("revoked forwards to membership", async () => {
		const finish = finishMembership({
			revoked: async () => null,
			keepFinishing() {},
		});
		expect(await finish.revoked({ role: "home" })).toBeNull();
	});
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	type AuthSandbox,
	createAuthSandbox,
	testRequestAccess,
} from "@nightshift/auth/testing";
import { invitation } from "@nightshift/db/schema";
import { asDate, HOUR_MS, now } from "@nightshift/time";
import { call } from "@orpc/server";

import { appRouter } from "../router";
import { testContext } from "../testing";

let sandbox: AuthSandbox;
beforeEach(async () => {
	sandbox = await createAuthSandbox();
});
afterEach(() => sandbox.cleanup());

/** An invitation of carol to Ada's Space, and Ada's headers. */
async function invited() {
	const ada = await sandbox.signUp("Ada");
	const space = await sandbox.auth.api.createOrganization({
		headers: ada.headers,
		body: { name: "Platform", slug: "platform" },
	});
	if (!space) throw new Error("no space");
	const { id } = await sandbox.auth.api.createInvitation({
		headers: ada.headers,
		body: {
			email: "carol@example.com",
			role: "member",
			organizationId: space.id,
		},
	});
	await sandbox.auth.api.setActiveOrganization({
		headers: ada.headers,
		body: { organizationId: space.id },
	});
	return { id, headers: ada.headers };
}

/** The one invitation of the test is past its time. */
const expire = () =>
	sandbox.db.update(invitation).set({ expiresAt: asDate(now() - HOUR_MS) });

describe("invitations", () => {
	test("the link of an invitation past its time shows it as expired", async () => {
		const { id } = await invited();
		const context = testContext({ db: sandbox.db });
		const get = () =>
			call(appRouter.invitations.get, { invitationId: id }, { context });
		expect((await get()).status).toBe("pending");
		await expire();
		expect((await get()).status).toBe("expired");
	});

	test("the Members page leaves out an invitation past its time", async () => {
		const { id, headers } = await invited();
		const context = testContext({
			db: sandbox.db,
			access: await testRequestAccess(sandbox.auth, sandbox.db, headers, null),
		});
		const list = () => call(appRouter.members.list, undefined, { context });
		expect((await list()).invitations.map((i) => i.id)).toEqual([id]);
		await expire();
		expect((await list()).invitations).toEqual([]);
	});
});

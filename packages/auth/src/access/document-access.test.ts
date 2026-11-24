import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { type AuthSandbox, createAuthSandbox } from "../testing";
import { turnOnTwoFactor } from "../testing/two-factor";
import {
	testDocumentAccess,
	testLocalPerson,
	testLocalSession,
} from "../testing/wires";
import type { DocumentOf, SyncDeviceKey } from "./domain/sync-access";

/**
 * Who may open which synced document, through the wire: real sessions,
 * roles and two-factor on a database. The rules themselves are in
 * `application/authorize-document.test.ts`. The transport that honours
 * the answer is tested in the daemon (`sync.test.ts`).
 */

let people: AuthSandbox;
/** The Person who owns this computer. */
let ownerId: string;
/** What each document name is, as this Host's documents say. */
let documents: Map<string, DocumentOf>;
/** Device keys this Host knows: token → the key, resolved. */
let deviceKeys: Map<string, SyncDeviceKey>;

/** This computer's own Device document. */
const OWN = "device:this-computer";

beforeEach(async () => {
	people = await createAuthSandbox();
	ownerId = (await testLocalPerson(people.db)).userId;
	documents = new Map([[OWN, { kind: "device", deviceId: "this-computer" }]]);
	deviceKeys = new Map();
});
afterEach(() => people.cleanup());

/** The policy as the daemon wires it, with the Host's options. */
function policy(options: { requireTwoFactor?: boolean } = {}) {
	return testDocumentAccess(people.auth, people.db, {
		localSession: testLocalSession(people.auth, people.db, ownerId),
		ownerId,
		// This computer's own requests come from this address.
		isThisComputer: (peer) => peer === "this-computer",
		documentOf: async (name) => documents.get(name) ?? null,
		...(options.requireTwoFactor ? { policy: { requireTwoFactor: true } } : {}),
		deviceKey: async (token) => deviceKeys.get(token) ?? null,
	});
}

/** What the policy answers to a client. Without a cookie or a token: this computer's UI. */
async function access(
	documentName: string,
	from: {
		cookie?: Headers;
		token?: string;
		/** Another computer. Default: this one. */
		remote?: boolean;
		requireTwoFactor?: boolean;
	} = {},
) {
	const granted = await policy(from)({
		documentName,
		token: from.token ?? "browser",
		peer: from.remote ? "203.0.113.9" : "this-computer",
		request: new Request("http://localhost:3000/sync", {
			headers: { cookie: from.cookie?.get("cookie") ?? "" },
		}),
	});
	return typeof granted === "object" ? granted.access : granted;
}

/**
 * Platform: Ada owns it, Bob is a member, Cy a viewer. Its Space document,
 * and the flow documents of its Project `shop`. Bob and Cy each have a
 * Device with a key of this Host.
 */
async function platform() {
	const ada = await people.signUp("Ada");
	const bob = await people.signUp("Bob");
	const cy = await people.signUp("Cy");
	const space = await people.auth.api.createOrganization({
		headers: ada.headers,
		body: { name: "Platform", slug: "platform" },
	});
	if (!space) throw new Error("no space");
	for (const [person, role] of [
		[bob, "member"],
		[cy, "viewer"],
	] as const) {
		await people.auth.api.addMember({
			body: { userId: person.userId, role, organizationId: space.id },
		});
	}
	const spaceId = space.id;
	documents.set("space:platform", { kind: "space", spaceId });
	documents.set("flows:shop", { kind: "flows", spaceId });
	documents.set("flows-history:shop", { kind: "flows", spaceId });
	for (const [token, person] of [
		["nsd_bob", bob],
		["nsd_cy", cy],
	] as const) {
		deviceKeys.set(token, {
			deviceId: `device-${token}`,
			personId: person.userId,
			home: false,
		});
	}
	return { spaceId, ada, bob };
}

describe("the Device document", () => {
	test("this computer's UI changes its own document", async () => {
		expect(await access(OWN)).toBe("write");
	});
});

describe("a Space document", () => {
	test("a removed member is refused", async () => {
		const { spaceId, ada, bob } = await platform();
		expect(await access("space:platform", { cookie: bob.headers })).toBe(
			"read",
		);
		await people.auth.api.removeMember({
			headers: ada.headers,
			body: { memberIdOrEmail: "bob@example.com", organizationId: spaceId },
		});
		expect(await access("space:platform", { cookie: bob.headers })).toBe(false);
	});
});

describe("a flow document", () => {
	test("a Device of a member changes it, and a Device of a viewer only reads", async () => {
		await platform();
		for (const name of ["flows:shop", "flows-history:shop"]) {
			expect(await access(name, { token: "nsd_bob" })).toBe("write");
			expect(await access(name, { token: "nsd_cy" })).toBe("read");
		}
	});
});

describe("on a Host that requires two-factor", () => {
	test("a session from another computer opens nothing until its Person turns two-factor on", async () => {
		const { ada } = await platform();
		const remote = { remote: true, requireTwoFactor: true };
		expect(
			await access("space:platform", { cookie: ada.headers, ...remote }),
		).toBe(false);
		const { headers } = await turnOnTwoFactor(people.auth, ada.headers);
		expect(await access("space:platform", { cookie: headers, ...remote })).toBe(
			"read",
		);
	});
});

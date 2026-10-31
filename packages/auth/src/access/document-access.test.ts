import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createLocalSession } from "../local-session";
import { localPerson } from "../spaces";
import { type AuthSandbox, createAuthSandbox } from "../testing/sandbox";
import { turnOnTwoFactor } from "../testing/two-factor";
import {
	type DocumentOf,
	documentAccess,
	type SyncDeviceKey,
} from "./document-access";

/**
 * Who may open which synced document, at the policy's own interface: the
 * relay asks it for each connection with the document's name, the token
 * the client sent, its address and its upgrade request. The transport
 * that honours the answer is tested in the daemon (`sync.test.ts`).
 */

let people: AuthSandbox;
/** The Person who owns this computer. */
let ownerId: string;
/** What each document name is, as this Host's documents say. */
let documents: Map<string, DocumentOf>;
/** Device keys this Host knows: token → the key, resolved. */
let deviceKeys: Map<string, SyncDeviceKey>;
/** Documents this Host keeps for paired Devices: name → owner. */
let keptOwners: Map<string, string>;

/** This computer's own Device document. */
const OWN = "device:this-computer";

beforeEach(async () => {
	people = await createAuthSandbox();
	ownerId = (await localPerson(people.db)).userId;
	documents = new Map([[OWN, { kind: "device", deviceId: "this-computer" }]]);
	deviceKeys = new Map();
	keptOwners = new Map();
});
afterEach(() => people.cleanup());

/** The policy as the daemon wires it, with the Host's options. */
function policy(options: { requireTwoFactor?: boolean } = {}) {
	return documentAccess({
		auth: people.auth,
		db: people.db,
		localSession: createLocalSession(people.auth, people.db, ownerId),
		ownerId,
		// This computer's own requests come from this address.
		isThisComputer: (peer) => peer === "this-computer",
		documentOf: async (name) => documents.get(name) ?? null,
		...(options.requireTwoFactor ? { policy: { requireTwoFactor: true } } : {}),
		keptOwner: async (name) => keptOwners.get(name) ?? null,
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
 * Platform: Ada owns it, Bob is a member, Cy a viewer, Dee is not in it.
 * Its Space document, and the flow and knowledge documents of its Project
 * `shop`. Bob, Cy and Dee each have a Device with a key of this Host.
 */
async function platform() {
	const ada = await people.signUp("Ada");
	const bob = await people.signUp("Bob");
	const cy = await people.signUp("Cy");
	const dee = await people.signUp("Dee");
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
	documents.set("knowledge:shop", { kind: "knowledge", spaceId });
	for (const [token, person] of [
		["nsd_bob", bob],
		["nsd_cy", cy],
		["nsd_dee", dee],
	] as const) {
		deviceKeys.set(token, {
			deviceId: `device-${token}`,
			personId: person.userId,
			home: false,
		});
	}
	return { spaceId, ada, bob, cy, dee };
}

describe("the Device document", () => {
	test("this computer's UI changes its own document", async () => {
		expect(await access(OWN)).toBe("write");
	});

	test("another Person is refused, even on this computer", async () => {
		const dee = await people.signUp("Dee");
		expect(await access(OWN, { cookie: dee.headers })).toBe(false);
	});

	test("a name this Host does not serve is refused", async () => {
		expect(await access("device:someone-else")).toBe(false);
	});
});

describe("a Space document", () => {
	test("a member and a viewer read it, and neither changes it", async () => {
		const { bob, cy } = await platform();
		expect(await access("space:platform", { cookie: bob.headers })).toBe(
			"read",
		);
		expect(await access("space:platform", { cookie: cy.headers })).toBe("read");
	});

	test("a Person outside the Space is refused", async () => {
		const { dee } = await platform();
		expect(await access("space:platform", { cookie: dee.headers })).toBe(false);
	});

	test("a removed member is refused", async () => {
		const { spaceId, ada, bob } = await platform();
		await people.auth.api.removeMember({
			headers: ada.headers,
			body: { memberIdOrEmail: "bob@example.com", organizationId: spaceId },
		});
		expect(await access("space:platform", { cookie: bob.headers })).toBe(false);
	});

	test("this computer's Person is not a member of another Person's Space", async () => {
		await platform();
		expect(await access("space:platform")).toBe(false);
	});

	test("a Device reads the Space documents of its owner's Spaces, and changes none", async () => {
		await platform();
		expect(await access("space:platform", { token: "nsd_bob" })).toBe("read");
		expect(await access("space:platform", { token: "nsd_dee" })).toBe(false);
	});
});

describe("a flow document", () => {
	test("a member and a viewer read it in a browser, and neither changes it", async () => {
		const { bob, cy } = await platform();
		for (const name of ["flows:shop", "flows-history:shop"]) {
			expect(await access(name, { cookie: bob.headers })).toBe("read");
			expect(await access(name, { cookie: cy.headers })).toBe("read");
		}
	});

	test("a Device of a member changes it, and a Device of a viewer only reads", async () => {
		await platform();
		for (const name of ["flows:shop", "flows-history:shop"]) {
			expect(await access(name, { token: "nsd_bob" })).toBe("write");
			expect(await access(name, { token: "nsd_cy" })).toBe("read");
		}
	});

	test("a Person outside the Space, and a Project this Host does not have, are refused", async () => {
		await platform();
		expect(await access("flows:shop", { token: "nsd_dee" })).toBe(false);
		expect(await access("flows:no-such-project", { token: "nsd_bob" })).toBe(
			false,
		);
	});
});

describe("a knowledge document", () => {
	test("a Member reads it in a browser, and does not change it", async () => {
		const { bob } = await platform();
		expect(await access("knowledge:shop", { cookie: bob.headers })).toBe(
			"read",
		);
	});

	test("a Device of a Member who may start runs changes it, and a viewer's Device only reads", async () => {
		await platform();
		expect(await access("knowledge:shop", { token: "nsd_bob" })).toBe("write");
		expect(await access("knowledge:shop", { token: "nsd_cy" })).toBe("read");
	});

	test("a Person outside the Space, and a Project this Host does not have, are refused", async () => {
		await platform();
		expect(await access("knowledge:shop", { token: "nsd_dee" })).toBe(false);
		expect(
			await access("knowledge:no-such-project", { token: "nsd_bob" }),
		).toBe(false);
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

	test("this computer still opens its own document", async () => {
		expect(await access(OWN, { requireTwoFactor: true })).toBe("write");
	});
});

describe("Device keys", () => {
	const KEY = "nsd_the-key-of-device-b";
	const B = "device:device-b";
	/** C is another home Device of the owner. */
	const C = "device:device-c";

	/** Device B, paired with this Host (its home by default), of this computer's Person. */
	function pairB(home = true) {
		documents.set(B, { kind: "device", deviceId: "device-b" });
		documents.set(C, { kind: "device", deviceId: "device-c" });
		keptOwners.set(B, ownerId);
		keptOwners.set(C, ownerId);
		deviceKeys.set(KEY, { deviceId: "device-b", personId: ownerId, home });
	}

	test("a Device changes its own document on its home Host, with its Device as the connection's context", async () => {
		pairB();
		const granted = await policy()({
			documentName: B,
			token: KEY,
			peer: "203.0.113.9",
			request: new Request("https://host.example.com/sync"),
		});
		expect(granted).toEqual({
			access: "write",
			context: { deviceId: "device-b" },
		});
	});

	test("the owner's UI on the Host changes a document it keeps for a Device, and another Person does not", async () => {
		pairB();
		const dee = await people.signUp("Dee");
		expect(await access(B)).toBe("write");
		expect(await access(B, { cookie: dee.headers })).toBe(false);
	});

	test("a home Device reads another Device of its owner, and the Host's own when its owner owns the Host", async () => {
		pairB();
		expect(await access(C, { token: KEY })).toBe("read");
		expect(await access(OWN, { token: KEY })).toBe("read");
	});

	test("another Person's Device document is refused", async () => {
		pairB();
		const dee = await people.signUp("Dee");
		const D = "device:device-d";
		documents.set(D, { kind: "device", deviceId: "device-d" });
		keptOwners.set(D, dee.userId);
		expect(await access(D, { token: KEY })).toBe(false);
	});

	test("a Device of another Person reads neither the owner's Devices nor the Host's own", async () => {
		pairB();
		const dee = await people.signUp("Dee");
		deviceKeys.set("nsd_dee", {
			deviceId: "device-d",
			personId: dee.userId,
			home: true,
		});
		expect(await access(C, { token: "nsd_dee" })).toBe(false);
		expect(await access(OWN, { token: "nsd_dee" })).toBe(false);
	});

	test("over a Guest Host a Device opens no Device document, not even its own", async () => {
		pairB(false);
		for (const name of [B, C, OWN]) {
			expect(await access(name, { token: KEY })).toBe(false);
		}
	});

	test("a key of another Person is refused", async () => {
		pairB();
		deviceKeys.set(KEY, {
			deviceId: "device-b",
			personId: "someone",
			home: true,
		});
		expect(await access(B, { token: KEY })).toBe(false);
	});

	test("an unknown key from this computer does not get the local session", async () => {
		expect(await access(OWN, { token: "nsd_unknown" })).toBe(false);
	});
});

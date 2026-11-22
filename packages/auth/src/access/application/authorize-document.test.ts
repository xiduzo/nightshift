import { describe, expect, test } from "bun:test";
import type { Role } from "../../spaces";
import { inMemoryAccessPorts } from "../adapters/out/in-memory-neighbours";
import { authorizeDocument } from "./authorize-document";

/**
 * The use case authorizeDocument, on in-memory adapters. The twins of
 * `document-access.test.ts`: who may open which synced document.
 */

/** This computer's own Device document. */
const OWN = "device:this-computer";

function setUp() {
	const ports = inMemoryAccessPorts();
	ports.documents.documents.set(OWN, {
		kind: "device",
		deviceId: "this-computer",
	});
	const authorize = authorizeDocument(ports);
	/** What a client gets. Without a cookie or a token: this computer's UI. */
	const access = async (
		documentName: string,
		from: { cookie?: Headers; token?: string; remote?: boolean } = {},
	) => {
		const granted = await authorize({
			documentName,
			token: from.token ?? "browser",
			peer: from.remote ? "203.0.113.9" : "this-computer",
			request: new Request("http://localhost:3000/sync", {
				headers: { cookie: from.cookie?.get("cookie") ?? "" },
			}),
		});
		return typeof granted === "object" ? granted.access : granted;
	};
	return { ports, authorize, access };
}

/** Platform: Bob is a member, Cy a viewer. Each has a Device key; Dee too, outside it. */
function platform(ports: ReturnType<typeof inMemoryAccessPorts>) {
	const join = (personId: string, role: Role) =>
		ports.members.join(personId, {
			id: "platform",
			name: "Platform",
			personal: false,
			role,
		});
	join("bob", "member");
	join("cy", "viewer");
	const spaceId = "platform";
	ports.documents.documents.set("space:platform", { kind: "space", spaceId });
	ports.documents.documents.set("flows:shop", { kind: "flows", spaceId });
	ports.documents.documents.set("knowledge:shop", {
		kind: "knowledge",
		spaceId,
	});
	for (const person of ["bob", "cy", "dee"]) {
		ports.documents.deviceKeys.set(`nsd_${person}`, {
			deviceId: `device-${person}`,
			personId: person,
			home: false,
		});
	}
	return {
		bob: ports.sessionReader.signIn("bob"),
		cy: ports.sessionReader.signIn("cy"),
		dee: ports.sessionReader.signIn("dee"),
	};
}

describe("the Device document", () => {
	test("this computer's UI changes its own document, another Person does not", async () => {
		const { ports, access } = setUp();
		expect(await access(OWN)).toBe("write");
		const dee = ports.sessionReader.signIn("dee");
		expect(await access(OWN, { cookie: dee })).toBe(false);
	});

	test("a name this Host does not serve is refused", async () => {
		const { access } = setUp();
		expect(await access("device:someone-else")).toBe(false);
	});
});

describe("a Space document", () => {
	test("a member and a viewer read it, a Person outside is refused", async () => {
		const { ports, access } = setUp();
		const { bob, cy, dee } = platform(ports);
		expect(await access("space:platform", { cookie: bob })).toBe("read");
		expect(await access("space:platform", { cookie: cy })).toBe("read");
		expect(await access("space:platform", { cookie: dee })).toBe(false);
	});

	test("a Device reads the Space documents of its owner's Spaces, and changes none", async () => {
		const { ports, access } = setUp();
		platform(ports);
		expect(await access("space:platform", { token: "nsd_bob" })).toBe("read");
		expect(await access("space:platform", { token: "nsd_dee" })).toBe(false);
	});
});

describe("flow and knowledge documents", () => {
	test("a Device of a member changes them, a Device of a viewer only reads", async () => {
		const { ports, access } = setUp();
		const { bob } = platform(ports);
		for (const name of ["flows:shop", "knowledge:shop"]) {
			expect(await access(name, { token: "nsd_bob" })).toBe("write");
			expect(await access(name, { token: "nsd_cy" })).toBe("read");
			expect(await access(name, { token: "nsd_dee" })).toBe(false);
			expect(await access(name, { cookie: bob })).toBe("read");
		}
	});
});

describe("on a Host that requires two-factor", () => {
	test("a session from another computer opens nothing until two-factor is on", async () => {
		const { ports, access } = setUp();
		ports.documents.policy = { requireTwoFactor: true };
		const { bob } = platform(ports);
		expect(await access("space:platform", { cookie: bob, remote: true })).toBe(
			false,
		);
		const withTwoFactor = ports.sessionReader.signIn("bob", {
			twoFactorEnabled: true,
		});
		expect(
			await access("space:platform", { cookie: withTwoFactor, remote: true }),
		).toBe("read");
		expect(await access(OWN)).toBe("write");
	});
});

describe("Device keys", () => {
	const KEY = "nsd_the-key-of-device-b";
	const B = "device:device-b";
	const C = "device:device-c";

	function pairB(ports: ReturnType<typeof inMemoryAccessPorts>, home = true) {
		ports.documents.documents.set(B, { kind: "device", deviceId: "device-b" });
		ports.documents.documents.set(C, { kind: "device", deviceId: "device-c" });
		ports.documents.keptOwners.set(B, "owner");
		ports.documents.keptOwners.set(C, "owner");
		ports.documents.deviceKeys.set(KEY, {
			deviceId: "device-b",
			personId: "owner",
			home,
		});
	}

	test("a Device changes its own document on its home Host, with its Device as the context", async () => {
		const { ports, authorize } = setUp();
		pairB(ports);
		expect(
			await authorize({
				documentName: B,
				token: KEY,
				peer: "203.0.113.9",
				request: new Request("https://host.example.com/sync"),
			}),
		).toEqual({ access: "write", context: { deviceId: "device-b" } });
	});

	test("a home Device reads another Device of its owner, and the Host's own", async () => {
		const { ports, access } = setUp();
		pairB(ports);
		expect(await access(C, { token: KEY })).toBe("read");
		expect(await access(OWN, { token: KEY })).toBe("read");
	});

	test("over a Guest Host a Device opens no Device document, not even its own", async () => {
		const { ports, access } = setUp();
		pairB(ports, false);
		for (const name of [B, C, OWN]) {
			expect(await access(name, { token: KEY })).toBe(false);
		}
	});

	test("an unknown key from this computer does not get the local session", async () => {
		const { ports, access } = setUp();
		expect(await access(OWN, { token: "nsd_unknown" })).toBe(false);
		expect(ports.sessionReader.reads).toBe(0);
	});
});

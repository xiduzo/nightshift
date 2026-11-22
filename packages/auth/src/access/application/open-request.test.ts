import { describe, expect, test } from "bun:test";
import { OPEN_HOST } from "../../host-access";
import { inMemoryAccessPorts } from "../adapters/out/in-memory-neighbours";
import { openRequest } from "./open-request";

/** The use case openRequest, on in-memory adapters. The twins of `request.test.ts`. */

const PLATFORM = {
	id: "platform",
	name: "Platform",
	personal: false,
} as const;

describe("openRequest", () => {
	test("a request from this computer reads the session and the memberships once, and decides in memory", async () => {
		const ports = inMemoryAccessPorts();
		ports.members.join("owner", {
			id: "mine",
			name: "Personal",
			personal: true,
			role: "owner",
		});
		const access = await openRequest(ports)({
			headers: new Headers(),
			local: ports.local,
			policy: OPEN_HOST,
		});
		expect(access.session?.user.id).toBe("owner");
		expect(access.spaceId).toBe("mine");
		expect(await access.can({ run: ["start"] })).toBe(true);
		expect(await access.can({ gate: ["resolve"] }, "mine")).toBe(true);
		expect(ports.members.reads).toEqual(["owner"]);
		expect(ports.sessionReader.reads).toBe(1);
	});

	test("a role decides in each Space of the Person, and no Space of another", async () => {
		const ports = inMemoryAccessPorts();
		ports.members.join("bob", { ...PLATFORM, role: "viewer" });
		const headers = ports.sessionReader.signIn("bob");
		const first = await openRequest(ports)({
			headers,
			local: null,
			policy: OPEN_HOST,
		});
		// No personal Space yet: one is made, and Bob works in it. The
		// memberships this request read do not have it yet.
		expect(ports.members.made).toEqual(["bob"]);
		expect(first.spaceId).toBe("personal-bob");
		expect(await first.can({ run: ["start"] })).toBe(false);
		const access = await openRequest(ports)({
			headers,
			local: null,
			policy: OPEN_HOST,
		});
		expect(await access.can({ run: ["start"] })).toBe(true);
		expect(await access.can({ run: ["start"] }, "platform")).toBe(false);
		expect(await access.can({ project: ["move"] }, "space-of-nobody")).toBe(
			false,
		);
		expect(await access.roleIn("platform")).toBe("viewer");
	});

	test("the active Space of the session counts while the Person is a member of it", async () => {
		const ports = inMemoryAccessPorts();
		ports.members.join("ada", { ...PLATFORM, role: "member" });
		const open = openRequest(ports);
		const inPlatform = await open({
			headers: ports.sessionReader.signIn("ada", { activeSpaceId: "platform" }),
			local: null,
			policy: OPEN_HOST,
		});
		expect(inPlatform.spaceId).toBe("platform");
		const gone = await open({
			headers: ports.sessionReader.signIn("ada", { activeSpaceId: "left" }),
			local: null,
			policy: OPEN_HOST,
		});
		expect(gone.spaceId).toBe("personal-ada");
	});

	test("without a session: no Space, no role, and a Member change is refused", async () => {
		const ports = inMemoryAccessPorts();
		const access = await openRequest(ports)({
			headers: new Headers(),
			local: null,
			policy: OPEN_HOST,
		});
		expect(access.session).toBeNull();
		expect(access.spaceId).toBeNull();
		expect(await access.can({ run: ["start"] }, "platform")).toBe(false);
		expect(await access.roleIn("platform")).toBeNull();
		expect(ports.members.reads).toEqual([]);
		await expect(
			access.members.invite("a@example.com", "member"),
		).rejects.toThrow("Sign in to use Night Shift.");
	});

	test("a Space made through the request gets a slug of its name, and the memberships are read again", async () => {
		const ports = inMemoryAccessPorts();
		const access = await openRequest(ports)({
			headers: ports.sessionReader.signIn("ada"),
			local: null,
			policy: OPEN_HOST,
		});
		const { id } = await access.createSpace("Platform Team");
		expect(ports.organizations.spaces.get(id)?.slug).toBe(
			"platform-team-id1-0000",
		);
		ports.members.join("ada", {
			id,
			name: "Platform Team",
			personal: false,
			role: "owner",
		});
		expect(await access.can({ space: ["delete"] }, id)).toBe(true);
		expect(ports.members.reads).toEqual(["ada", "ada"]);
	});

	test("the Members of the session's Space change through the organizations, as that Person", async () => {
		const ports = inMemoryAccessPorts();
		ports.members.join("ada", { ...PLATFORM, role: "owner" });
		const adaHeaders = ports.sessionReader.signIn("ada", {
			activeSpaceId: "platform",
		});
		ports.organizations.members.push({
			id: "m-ada",
			spaceId: "platform",
			personId: "ada",
			role: "owner",
		});
		const ada = await openRequest(ports)({
			headers: adaHeaders,
			local: null,
			policy: OPEN_HOST,
		});
		const invitation = await ada.members.invite("bob@example.com", "viewer");
		const bob = await openRequest(ports)({
			headers: ports.sessionReader.signIn("bob"),
			local: null,
			policy: OPEN_HOST,
		});
		expect(await bob.members.accept(invitation.id)).toEqual({
			spaceId: "platform",
		});
		const bobs = ports.organizations.members.find((m) => m.personId === "bob");
		await ada.members.setRole(bobs?.id ?? "", "member");
		expect(bobs?.role).toBe("member");
		await ada.members.remove(bobs?.id ?? "");
		expect(ports.organizations.members.some((m) => m.personId === "bob")).toBe(
			false,
		);
	});

	test("the Host's decision: a session from elsewhere without two-factor is refused", async () => {
		const ports = inMemoryAccessPorts();
		const policy = { requireTwoFactor: true };
		const open = openRequest(ports);
		const elsewhere = await open({
			headers: ports.sessionReader.signIn("ada"),
			local: null,
			policy,
		});
		expect(elsewhere.hostAccess.allowed).toBe(false);
		const here = await open({
			headers: new Headers(),
			local: ports.local,
			policy,
		});
		expect(here.hostAccess.allowed).toBe(true);
	});
});

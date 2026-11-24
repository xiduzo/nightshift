import { describe, expect, test } from "bun:test";
import { inMemoryAccessPorts } from "../adapters/out/in-memory-neighbours";
import { tokenOf } from "../adapters/out/in-memory-session-reader";
import { OPEN_HOST } from "../host-access";
import { openAuthEndpoint } from "./open-auth-endpoint";

/** The use case openAuthEndpoint, on in-memory adapters. */

describe("openAuthEndpoint", () => {
	test("a request from this computer gets the local cookie without a read of the session", async () => {
		const ports = inMemoryAccessPorts();
		const { headers, hostAccess } = await openAuthEndpoint(ports)({
			headers: new Headers(),
			local: ports.local,
			policy: { requireTwoFactor: true },
		});
		expect(ports.sessionReader.reads).toBe(0);
		expect(hostAccess.allowed).toBe(true);
		expect(tokenOf(headers)).not.toBeNull();
	});

	test("a request from elsewhere reads the session only when the Host requires two-factor", async () => {
		const ports = inMemoryAccessPorts();
		const headers = ports.sessionReader.signIn("ada");
		const open = openAuthEndpoint(ports);
		const open1 = await open({ headers, local: null, policy: OPEN_HOST });
		expect(open1).toEqual({ headers, hostAccess: { allowed: true } });
		expect(ports.sessionReader.reads).toBe(0);
		const refused = await open({
			headers,
			local: null,
			policy: { requireTwoFactor: true },
		});
		expect(refused.hostAccess.allowed).toBe(false);
		expect(ports.sessionReader.reads).toBe(1);
	});
});

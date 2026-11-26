import { describe, expect, test } from "bun:test";
import { isLoopbackHost } from "./loopback";

describe("a host on this computer", () => {
	test.each([
		["localhost", true],
		["[::1]", true],
		["::1", true],
		["127.0.0.1", true],
		["127.1.2.3", true],
		["127.255.255.255", true],
		["127.999.0.1", true],
		["127.0.0.1.", false],
		["127.0.0", false],
		["127.1", false],
		["x127.0.0.1", false],
		["127.0.0.1x", false],
		["LOCALHOST", false],
		["localhost.", false],
		["localhost.localdomain", false],
		["0.0.0.0", false],
		["[::]", false],
		["::", false],
		["0:0:0:0:0:0:0:1", false],
		["[0:0:0:0:0:0:0:1]", false],
		["::ffff:127.0.0.1", false],
		["[::ffff:7f00:1]", false],
		["10.0.0.1", false],
		["192.168.1.20", false],
		["studio.example.com", false],
		["", false],
	])("%p is %p", (hostname, loopback) => {
		expect(isLoopbackHost(hostname)).toBe(loopback);
	});
});

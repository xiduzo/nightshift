import { describe, expect, test } from "bun:test";
import { addressProblem, checkHost } from "./web-addresses";

/**
 * Where a web request may go: the table of address ranges, on a laptop
 * (`privateNetwork`) and on a Host whose Settings keep its network out,
 * and the check of a host name by every address it resolves to.
 */

const laptop = { privateNetwork: true };
const host = { privateNetwork: false };

describe("addressProblem", () => {
	test.each([
		// Link-local, where the cloud metadata service lives.
		["169.254.169.254", "never", "never"],
		["169.254.0.1", "never", "never"],
		["fe80::1", "never", "never"],
		// Metadata services outside link-local.
		["fd00:ec2::254", "never", "never"],
		["100.100.100.200", "never", "never"],
		// The unspecified address, broadcast, multicast, reserved.
		["0.0.0.0", "never", "never"],
		["::", "never", "never"],
		["255.255.255.255", "never", "never"],
		["224.0.0.1", "never", "never"],
		["ff02::1", "never", "never"],
		["240.0.0.1", "never", "never"],
		// An IPv6 address that carries a blocked IPv4 one.
		["::ffff:169.254.169.254", "never", "never"],
		["64:ff9b::a9fe:a9fe", "never", "never"],
		["2002:a9fe:a9fe::1", "never", "never"],
		// This computer and its network: a laptop may, a Host not by default.
		["127.0.0.1", null, "private"],
		["::1", null, "private"],
		["::ffff:127.0.0.1", null, "private"],
		["10.1.2.3", null, "private"],
		["172.16.0.1", null, "private"],
		["192.168.1.10", null, "private"],
		["fd12:3456::1", null, "private"],
		["100.64.0.1", null, "private"],
		// Public addresses: everyone may.
		["93.184.216.34", null, null],
		["2606:2800:220:1::1", null, null],
		["8.8.8.8", null, null],
	] as const)(
		"%s: %p on a laptop, %p on a Host",
		(address, onLaptop, onHost) => {
			expect(addressProblem(address, laptop)).toBe(onLaptop);
			expect(addressProblem(address, host)).toBe(onHost);
		},
	);

	test("a Host whose Settings allow its network reaches it, never link-local", () => {
		expect(addressProblem("10.0.0.5", laptop)).toBeNull();
		expect(addressProblem("169.254.169.254", laptop)).toBe("never");
	});
});

describe("checkHost", () => {
	test("checks every address a name resolves to", async () => {
		const resolve = async () => ["93.184.216.34", "10.0.0.7"];
		expect(
			await checkHost(new URL("https://mixed.example"), { ...host, resolve }),
		).toEqual({ kind: "blocked", why: "private" });
		expect(
			await checkHost(new URL("https://mixed.example"), {
				...laptop,
				resolve,
			}),
		).toEqual({ kind: "ok" });
	});

	test("reads an address in the URL without resolving it", async () => {
		const resolve = async (): Promise<string[]> => {
			throw new Error("not asked");
		};
		expect(
			await checkHost(new URL("http://[::1]:8080/"), { ...host, resolve }),
		).toEqual({ kind: "blocked", why: "private" });
		// The URL parser reads a decimal address as the IPv4 one.
		expect(
			await checkHost(new URL("http://2852039166/"), { ...laptop, resolve }),
		).toEqual({ kind: "blocked", why: "never" });
	});

	test("a name that does not resolve is a network failure", async () => {
		const resolve = async (): Promise<string[]> => {
			throw new Error("getaddrinfo ENOTFOUND nowhere.example");
		};
		expect(
			await checkHost(new URL("https://nowhere.example"), {
				...laptop,
				resolve,
			}),
		).toEqual({
			kind: "unresolved",
			message: "getaddrinfo ENOTFOUND nowhere.example",
		});
	});
});

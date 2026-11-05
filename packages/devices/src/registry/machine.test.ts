import { describe, expect, test } from "bun:test";
import { machineFingerprint, parseIoreg, parseMachineGuid } from "./machine";

const reads = (id: string | null) => ({
	container: false,
	user: "501",
	readHardwareId: async () => id,
});

describe("reading the hardware id", () => {
	test("macOS says it in the output of ioreg", () => {
		const output = `+-o J616sAP  <class IOPlatformExpertDevice>
    {
      "IOPlatformSerialNumber" = "ABC"
      "IOPlatformUUID" = "11111111-2222-3333-4444-555555555555"
    }`;
		expect(parseIoreg(output)).toBe("11111111-2222-3333-4444-555555555555");
		expect(parseIoreg("no such line")).toBeNull();
	});

	test("Windows says it in the output of reg query", () => {
		const output = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography
    MachineGuid    REG_SZ    aaaa-bbbb
`;
		expect(parseMachineGuid(output)).toBe("aaaa-bbbb");
		expect(parseMachineGuid("ERROR: not found")).toBeNull();
	});
});

describe("machineFingerprint", () => {
	test("one computer and one user have one fingerprint, and it hides the id", async () => {
		const first = await machineFingerprint(reads("hardware-1"));
		expect(first).toMatch(/^[0-9a-f]{64}$/);
		expect(first).not.toContain("hardware-1");
		expect(await machineFingerprint(reads("hardware-1"))).toBe(first);
	});

	test("another computer has another fingerprint", async () => {
		expect(await machineFingerprint(reads("hardware-1"))).not.toBe(
			await machineFingerprint(reads("hardware-2")),
		);
	});

	test("two OS users of one computer are two Devices", async () => {
		expect(await machineFingerprint(reads("hardware-1"))).not.toBe(
			await machineFingerprint({ ...reads("hardware-1"), user: "502" }),
		);
	});

	test("a development install has none", async () => {
		expect(
			await machineFingerprint({ ...reads("hardware-1"), dev: true }),
		).toBeNull();
	});

	test("a container has none", async () => {
		expect(
			await machineFingerprint({ ...reads("hardware-1"), container: true }),
		).toBeNull();
	});

	test("a computer that cannot tell has none, and the start goes on", async () => {
		expect(await machineFingerprint(reads(null))).toBeNull();
		expect(await machineFingerprint(reads("uninitialized"))).toBeNull();
		expect(await machineFingerprint(reads("00000000"))).toBeNull();
		expect(
			await machineFingerprint({
				...reads("x"),
				readHardwareId: async () => {
					throw new Error("no ioreg");
				},
			}),
		).toBeNull();
	});
});

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { inContainer } from "./self-device";

/**
 * The fingerprint of this computer (ADR 20): a hash of its hardware id and
 * the OS user. A home Host keeps it with the Device, so the same computer
 * pairing again gets its Device back. The hardware id itself never leaves
 * this computer. The OS user is part of it because two users of one
 * computer have their own files and keychains: they are two Devices.
 */

const DOMAIN = "nightshift-machine-v1";
const READ_TIMEOUT_MS = 3_000;

/** The ways a computer that is not one of ours says that it has no id. */
const NO_ID = /^(?:0+|uninitialized)$/i;

/** What `ioreg -rd1 -c IOPlatformExpertDevice` prints, read for the hardware UUID. */
export function parseIoreg(output: string): string | null {
	return /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(output)?.[1]?.trim() || null;
}

/** What `reg query ... /v MachineGuid` prints, read for the GUID. */
export function parseMachineGuid(output: string): string | null {
	return /MachineGuid\s+REG_\w+\s+(\S+)/i.exec(output)?.[1]?.trim() || null;
}

function run(file: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(file, args, { timeout: READ_TIMEOUT_MS }, (error, stdout) => {
			if (error) reject(error);
			else resolve(stdout);
		});
	});
}

/** The file's first line, or null when it cannot be read. */
function firstLine(path: string): string | null {
	try {
		return readFileSync(path, "utf8").split("\n", 1)[0]?.trim() || null;
	} catch {
		return null;
	}
}

/** The hardware id of this computer, by platform. Null: this platform has none. */
async function hardwareId(platform: string): Promise<string | null> {
	switch (platform) {
		case "darwin":
			return parseIoreg(
				await run("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]),
			);
		case "linux":
			return (
				firstLine("/etc/machine-id") ?? firstLine("/var/lib/dbus/machine-id")
			);
		case "win32":
			return parseMachineGuid(
				await run("reg", [
					"query",
					"HKLM\\SOFTWARE\\Microsoft\\Cryptography",
					"/v",
					"MachineGuid",
				]),
			);
		default:
			return null;
	}
}

/**
 * This computer's fingerprint. Null when it must not have one or when it
 * cannot tell: a development install is not the computer (ADR 20), a
 * container has no hardware of its own, and a failed read never stops a
 * start.
 */
export async function machineFingerprint(
	opts: {
		dev?: boolean;
		container?: boolean;
		platform?: string;
		readHardwareId?: (platform: string) => Promise<string | null>;
		user?: string;
	} = {},
): Promise<string | null> {
	if (opts.dev) return null;
	if (opts.container ?? inContainer()) return null;
	try {
		const read = opts.readHardwareId ?? hardwareId;
		const id = await read(opts.platform ?? process.platform);
		if (!id || NO_ID.test(id)) return null;
		const user = opts.user ?? String(process.getuid?.() ?? userInfo().username);
		return createHash("sha256")
			.update(`${DOMAIN}\u0000${id}\u0000${user}`)
			.digest("hex");
	} catch {
		return null;
	}
}

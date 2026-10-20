import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { apikey } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";

import { createDeviceKeys, type DeviceKeys } from "./device-keys";
import {
	approvePairing,
	denyPairing,
	redeemPairing,
	reviewPairing,
	startPairing,
} from "./pairing";
import { type AuthSandbox, createAuthSandbox } from "./testing/sandbox";

/**
 * Pairing by device authorization, and the Device keys it ends in: through
 * the real plugins on a migrated database.
 */

let sandbox: AuthSandbox;
let keys: DeviceKeys;
beforeEach(async () => {
	sandbox = await createAuthSandbox();
	keys = createDeviceKeys({ auth: sandbox.auth, db: sandbox.db });
});
afterEach(() => sandbox.cleanup());

const DEVICE = "8d2c4c1e-device-b";

describe("pairing", () => {
	test("the Person who reviews a code approves it; the Device learns who", async () => {
		const ada = await sandbox.signUp("Ada");
		const code = await startPairing(sandbox.auth, DEVICE);
		expect(code.userCode).toMatch(/^[A-Z0-9]{8}$/);

		const pending = { deviceCode: code.deviceCode, deviceId: DEVICE };
		expect(await redeemPairing(sandbox.auth, pending)).toEqual({
			status: "pending",
		});

		// Typed with a dash and in lower case: still the same code.
		const typed = `${code.userCode.slice(0, 4)}-${code.userCode.slice(4)}`;
		const review = await reviewPairing(
			sandbox.auth,
			ada.headers,
			typed.toLowerCase(),
		);
		expect(review).toEqual({
			userCode: code.userCode,
			status: "pending",
			deviceId: DEVICE,
		});
		await approvePairing(sandbox.auth, ada.headers, code.userCode);

		const answer = await redeemAfterInterval(pending);
		expect(answer).toEqual({ status: "approved", personId: ada.userId });
		// No session of Ada's was handed out on the way.
		const sessions = await (await sandbox.auth.$context).internalAdapter
			.listSessions(ada.userId)
			.then((list) => list.length);
		expect(sessions).toBe(1);
		// The device code is used up.
		await expect(redeemPairing(sandbox.auth, pending)).rejects.toThrow(
			/not valid/,
		);
	});

	test("one Person cannot approve another Person's code (CVE-2026-45337)", async () => {
		const ada = await sandbox.signUp("Ada");
		const mallory = await sandbox.signUp("Mallory");
		const code = await startPairing(sandbox.auth, DEVICE);
		await reviewPairing(sandbox.auth, ada.headers, code.userCode);

		// Mallory knows the code, but Ada holds it.
		await expect(
			reviewPairing(sandbox.auth, mallory.headers, code.userCode),
		).rejects.toThrow(/Another person/);
		await expect(
			approvePairing(sandbox.auth, mallory.headers, code.userCode),
		).rejects.toThrow(/Another person/);
		await expect(
			denyPairing(sandbox.auth, mallory.headers, code.userCode),
		).rejects.toThrow(/Another person/);
		expect(
			await redeemAfterInterval({
				deviceCode: code.deviceCode,
				deviceId: DEVICE,
			}),
		).toEqual({ status: "pending" });
	});

	test("an approval needs a review first, and a session", async () => {
		const ada = await sandbox.signUp("Ada");
		const code = await startPairing(sandbox.auth, DEVICE);
		await expect(
			approvePairing(sandbox.auth, ada.headers, code.userCode),
		).rejects.toThrow(/Enter the code first/);
		await expect(
			reviewPairing(sandbox.auth, new Headers(), code.userCode),
		).rejects.toThrow(/Another person/);
	});

	test("a denied code ends the Device's wait", async () => {
		const ada = await sandbox.signUp("Ada");
		const code = await startPairing(sandbox.auth, DEVICE);
		await reviewPairing(sandbox.auth, ada.headers, code.userCode);
		await denyPairing(sandbox.auth, ada.headers, code.userCode);
		expect(
			await redeemAfterInterval({
				deviceCode: code.deviceCode,
				deviceId: DEVICE,
			}),
		).toEqual({ status: "denied" });
	});

	test("another Device cannot redeem the code", async () => {
		const ada = await sandbox.signUp("Ada");
		const code = await startPairing(sandbox.auth, DEVICE);
		await reviewPairing(sandbox.auth, ada.headers, code.userCode);
		await approvePairing(sandbox.auth, ada.headers, code.userCode);
		await expect(
			redeemPairing(sandbox.auth, {
				deviceCode: code.deviceCode,
				deviceId: "another-device",
			}),
		).rejects.toThrow(/not valid/);
	});

	test("an unknown code is refused in words", async () => {
		const ada = await sandbox.signUp("Ada");
		await expect(
			reviewPairing(sandbox.auth, ada.headers, "ZZZZZZZZ"),
		).rejects.toThrow(/No device waits with this code/);
	});
});

describe("Device keys", () => {
	test("a key resolves to its Device and Person, and only allows its own permissions", async () => {
		const ada = await sandbox.signUp("Ada");
		const { key } = await keys.issue({
			personId: ada.userId,
			deviceId: DEVICE,
			deviceName: "MacBook",
		});
		expect(key.startsWith("nsd_")).toBe(true);

		expect(await keys.verify(key, "sync")).toMatchObject({
			deviceId: DEVICE,
			personId: ada.userId,
			permissions: {
				sync: ["pull", "push"],
				relay: ["serve"],
				archive: ["put", "get"],
			},
		});
		// Hashed at rest.
		const [row] = await sandbox.db.select().from(apikey);
		expect(row?.key).not.toBe(key);
		expect(row?.key).not.toContain(key.slice(4));
	});

	test("a wrong key, a session token and a revoked key are refused", async () => {
		const ada = await sandbox.signUp("Ada");
		const { key } = await keys.issue({
			personId: ada.userId,
			deviceId: DEVICE,
			deviceName: "MacBook",
		});
		expect(await keys.verify(`${key}x`)).toBeNull();
		expect(await keys.verify("a-session-token")).toBeNull();

		await keys.revoke(DEVICE);
		expect(await keys.verify(key)).toBeNull();
	});

	test("pairing again replaces the Device's key", async () => {
		const ada = await sandbox.signUp("Ada");
		const first = await keys.issue({
			personId: ada.userId,
			deviceId: DEVICE,
			deviceName: "MacBook",
		});
		const second = await keys.issue({
			personId: ada.userId,
			deviceId: DEVICE,
			deviceName: "MacBook",
		});
		expect(await keys.verify(first.key)).toBeNull();
		expect(await keys.verify(second.key)).not.toBeNull();
	});

	test("a key unused for longer than the idle time expires; a use moves it on", async () => {
		const ada = await sandbox.signUp("Ada");
		const { key, keyId } = await keys.issue({
			personId: ada.userId,
			deviceId: DEVICE,
			deviceName: "MacBook",
		});
		const expiry = async () =>
			(
				await sandbox.db
					.select({ at: apikey.expiresAt })
					.from(apikey)
					.where(eq(apikey.id, keyId))
			)[0]?.at?.getTime() ?? 0;

		// Used two days ago, for the last time: the expiry moves on with this use.
		const twoDaysAgo = Date.now() + 28 * 86_400_000;
		await sandbox.db
			.update(apikey)
			.set({ expiresAt: new Date(twoDaysAgo) })
			.where(eq(apikey.id, keyId));
		expect(await keys.verify(key)).not.toBeNull();
		expect(await expiry()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

		// Past the idle time: refused, and gone.
		await sandbox.db
			.update(apikey)
			.set({ expiresAt: new Date(Date.now() - 1_000) })
			.where(eq(apikey.id, keyId));
		expect(await keys.verify(key)).toBeNull();
		expect(await sandbox.db.select().from(apikey)).toHaveLength(0);
	});
});

/** The Device polls no faster than the interval (`slow_down` otherwise). */
async function redeemAfterInterval(input: {
	deviceCode: string;
	deviceId: string;
}) {
	await Bun.sleep(2_050);
	return redeemPairing(sandbox.auth, input);
}

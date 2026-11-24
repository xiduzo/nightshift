import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { apikey } from "@nightshift/db/schema";
import { asDate, instantOrNull, now } from "@nightshift/time";
import { eq } from "drizzle-orm";
import { type AuthSandbox, createAuthSandbox } from "../../testing";
import { testDeviceKeys, testPairing } from "../../testing/wires";
import type { DeviceKeys } from "../device-keys";

/**
 * Pairing by device authorization, and the Device keys it ends in: through
 * the real plugins on a migrated database.
 */

let sandbox: AuthSandbox;
let keys: DeviceKeys;
let pairing: ReturnType<typeof testPairing>;
beforeEach(async () => {
	sandbox = await createAuthSandbox();
	keys = testDeviceKeys(sandbox.auth, sandbox.db);
	pairing = testPairing(sandbox.auth);
});
afterEach(() => sandbox.cleanup());

const DEVICE = "8d2c4c1e-device-b";

describe("pairing", () => {
	test("the Person who reviews a code approves it; the Device learns who", async () => {
		const ada = await sandbox.signUp("Ada");
		const code = await pairing.startPairing({ deviceId: DEVICE });
		expect(code.userCode).toMatch(/^[A-Z0-9]{8}$/);

		const pending = { deviceCode: code.deviceCode, deviceId: DEVICE };
		expect(await pairing.redeemPairing(pending)).toEqual({
			status: "pending",
		});

		// Typed with a dash and in lower case: still the same code.
		const typed = `${code.userCode.slice(0, 4)}-${code.userCode.slice(4)}`;
		const review = await pairing.reviewPairing({
			headers: ada.headers,
			userCode: typed.toLowerCase(),
		});
		expect(review).toEqual({
			userCode: code.userCode,
			status: "pending",
			deviceId: DEVICE,
		});
		await pairing.approvePairing({
			headers: ada.headers,
			userCode: code.userCode,
		});

		const answer = await redeemAfterInterval(pending);
		expect(answer).toEqual({ status: "approved", personId: ada.userId });
		// No session of Ada's was handed out on the way.
		const sessions = await (await sandbox.auth.$context).internalAdapter
			.listSessions(ada.userId)
			.then((list) => list.length);
		expect(sessions).toBe(1);
		// The device code is used up.
		await expect(pairing.redeemPairing(pending)).rejects.toThrow(/not valid/);
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

		// Kept in memory once verified, and still refused at once.
		expect(await keys.verify(key)).not.toBeNull();
		await keys.revoke(DEVICE);
		expect(await keys.verify(key)).toBeNull();
	});

	test("a key unused for longer than the idle time expires; a use moves it on", async () => {
		const ada = await sandbox.signUp("Ada");
		const { key, keyId } = await keys.issue({
			personId: ada.userId,
			deviceId: DEVICE,
			deviceName: "MacBook",
		});
		const expiry = async () =>
			instantOrNull(
				(
					await sandbox.db
						.select({ at: apikey.expiresAt })
						.from(apikey)
						.where(eq(apikey.id, keyId))
				)[0]?.at,
			) ?? 0;

		// Used two days ago, for the last time: the expiry moves on with this use.
		const twoDaysAgo = now() + 28 * 86_400_000;
		await sandbox.db
			.update(apikey)
			.set({ expiresAt: asDate(twoDaysAgo) })
			.where(eq(apikey.id, keyId));
		expect(await keys.verify(key)).not.toBeNull();
		expect(await expiry()).toBeGreaterThan(now() + 29 * 86_400_000);

		// Past the idle time: refused, and gone. (A Host keeps a valid key in
		// memory for a minute: a Host that starts now reads the row.)
		await sandbox.db
			.update(apikey)
			.set({ expiresAt: asDate(now() - 1_000) })
			.where(eq(apikey.id, keyId));
		keys = testDeviceKeys(sandbox.auth, sandbox.db);
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
	return pairing.redeemPairing(input);
}

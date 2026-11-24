import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import type { DeviceAuthorizations } from "../../application/ports";
import { NOT_YOURS, PAIRING_SCOPE } from "../../domain/pairing";

/** One adapter of `DeviceAuthorizations` to test. */
export type DeviceAuthorizationsUnderTest = {
	deviceAuthorizations: DeviceAuthorizations;
	/** A new Person, signed in: their id and the headers of their session. */
	signUp(name: string): Promise<{ personId: string; headers: Headers }>;
	/** Waits the poll interval, as a Device does between two polls. */
	wait(): Promise<void>;
	close(): Promise<void>;
};

const DEVICE = "8d2c4c1e-device-b";

/** What `work` refuses with: its kind and its words. */
async function refusalOf(work: Promise<unknown>) {
	const error = await work.then(
		() => null,
		(caught: unknown) => caught,
	);
	expect(error).toBeInstanceOf(Refusal);
	const { kind, message } = error as Refusal;
	return { kind, message };
}

/**
 * What every adapter of `DeviceAuthorizations` does.
 * `device-authorizations.contract.test.ts` runs it on the in-memory
 * adapter and on the real one.
 */
export function deviceAuthorizationsContract(
	name: string,
	make: () => Promise<DeviceAuthorizationsUnderTest>,
): void {
	describe(`DeviceAuthorizations contract: ${name}`, () => {
		let under: DeviceAuthorizationsUnderTest;
		let ada: { personId: string; headers: Headers };
		beforeEach(async () => {
			under = await make();
			ada = await under.signUp("Ada");
		});
		afterEach(async () => {
			await under.close();
		});

		test("an approved code gives the Device a token of the Person who approved it, once", async () => {
			const port = under.deviceAuthorizations;
			const code = await port.start(DEVICE, PAIRING_SCOPE);
			expect(code.userCode).toMatch(/^[A-Z0-9]{8}$/);
			const poll = { deviceCode: code.deviceCode, deviceId: DEVICE };
			expect(await port.poll(poll)).toEqual({
				error: "authorization_pending",
			});
			expect(await port.verify(ada.headers, code.userCode)).toEqual({
				status: "pending",
				clientId: DEVICE,
			});
			await port.approve(ada.headers, code.userCode);
			expect(await port.poll({ ...poll, deviceId: "another-device" })).toEqual({
				error: "invalid_grant",
			});
			await under.wait();
			const answer = await port.poll(poll);
			if (!("token" in answer)) throw new Error("no token");
			expect(await port.personOfToken(answer.token)).toBe(ada.personId);
			await port.forgetToken(answer.token);
			expect(await port.personOfToken(answer.token)).toBeNull();
			await under.wait();
			const again = await port.poll(poll);
			expect("token" in again).toBe(false);
		});

		test("the Person who holds a code alone answers it, and a denial ends the wait", async () => {
			const port = under.deviceAuthorizations;
			const mallory = await under.signUp("Mallory");
			const code = await port.start(DEVICE, PAIRING_SCOPE);
			expect(await refusalOf(port.approve(ada.headers, code.userCode))).toEqual(
				{ kind: "invalid", message: "Enter the code first, then approve it." },
			);
			// Without a session: no Person, so nobody holds the code.
			expect(
				(await port.verify(new Headers(), code.userCode)).clientId,
			).toBeNull();
			await port.verify(ada.headers, code.userCode);
			expect(
				(await port.verify(mallory.headers, code.userCode)).clientId,
			).toBeNull();
			expect(
				await refusalOf(port.approve(mallory.headers, code.userCode)),
			).toEqual({ kind: "forbidden", message: NOT_YOURS });
			expect(
				await refusalOf(port.deny(mallory.headers, code.userCode)),
			).toEqual({ kind: "forbidden", message: NOT_YOURS });
			await port.deny(ada.headers, code.userCode);
			await under.wait();
			expect(
				await port.poll({ deviceCode: code.deviceCode, deviceId: DEVICE }),
			).toEqual({ error: "access_denied" });
		});

		test("an unknown code is refused in words", async () => {
			expect(
				await refusalOf(
					under.deviceAuthorizations.verify(ada.headers, "ZZZZZZZZ"),
				),
			).toEqual({
				kind: "not-found",
				message:
					"No device waits with this code. Check the code and try again.",
			});
		});
	});
}

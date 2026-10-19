import { createHmac } from "node:crypto";

import type { Auth } from "./index";
import { cookiesOf } from "./test-support";

/** Test helpers for two-factor sign-in: the authenticator app's side. */

/** The secret an authenticator app reads from the setup link (base32, RFC 4648). */
export function secretOf(totpURI: string): string {
	const encoded = new URL(totpURI).searchParams.get("secret") ?? "";
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	let bits = "";
	for (const char of encoded.replace(/=+$/, "").toUpperCase()) {
		const value = alphabet.indexOf(char);
		if (value < 0) throw new Error(`${char} is not base32.`);
		bits += value.toString(2).padStart(5, "0");
	}
	const bytes = new Uint8Array(Math.floor(bits.length / 8));
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2);
	}
	return new TextDecoder().decode(bytes);
}

/** The code the authenticator app shows now (RFC 6238: SHA-1, 6 digits, 30 seconds). */
export function codeNow(secret: string, now = Date.now()): string {
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
	const hmac = createHmac("sha1", secret).update(counter).digest();
	const offset = (hmac[hmac.length - 1] ?? 0) & 0xf;
	const value = hmac.readUInt32BE(offset) & 0x7fffffff;
	return String(value % 1_000_000).padStart(6, "0");
}

/** The code the authenticator app shows now, as the two-factor plugin makes it. */
export async function codeFor(auth: Auth, secret: string): Promise<string> {
	return (await auth.api.generateTOTP({ body: { secret } })).code;
}

/**
 * Turns two-factor on for the session's Person, as the setup page does:
 * the password, then the first code from the app.
 */
export async function turnOnTwoFactor(
	auth: Auth,
	headers: Headers,
	password = "a-long-password",
): Promise<{ secret: string; backupCodes: string[]; headers: Headers }> {
	const enabled = await auth.api.enableTwoFactor({
		headers,
		body: { password },
	});
	if (!("totpURI" in enabled) || !enabled.totpURI || !enabled.backupCodes) {
		throw new Error("No setup link.");
	}
	const secret = secretOf(enabled.totpURI);
	const verified = await auth.api.verifyTOTP({
		headers,
		body: { code: await codeFor(auth, secret) },
		asResponse: true,
	});
	if (!verified.ok) throw new Error(`Not verified: ${verified.status}`);
	// The session is replaced by one that knows two-factor is on.
	return {
		secret,
		backupCodes: enabled.backupCodes,
		headers: cookiesOf(verified),
	};
}

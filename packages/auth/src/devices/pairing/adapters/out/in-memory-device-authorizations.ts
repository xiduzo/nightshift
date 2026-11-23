import { Refusal } from "@nightshift/refusal";
import type { DeviceAuthorizations } from "../../application/ports";
import { NOT_YOURS } from "../../domain/pairing";

/** A pairing code as the twin keeps it. */
type CodeRecord = {
	deviceCode: string;
	userCode: string;
	deviceId: string;
	status: "pending" | "approved" | "denied" | "used";
	/** The Person who reviewed it first. */
	heldBy: string | null;
};

const NO_DEVICE = new Refusal(
	"not-found",
	"No device waits with this code. Check the code and try again.",
);

/**
 * `DeviceAuthorizations` in memory. `personOf` tells who the headers carry
 * (null: no session). The codes are in `codes`, the plugin's session
 * tokens in `tokens`.
 */
export function inMemoryDeviceAuthorizations(
	personOf: (headers: Headers) => string | null = (headers) =>
		headers.get("x-person"),
) {
	let next = 0;
	const codes: CodeRecord[] = [];
	const tokens = new Map<string, string>();
	const held = (headers: Headers, userCode: string) => {
		const found = codes.find((c) => c.userCode === userCode);
		if (!found) throw NO_DEVICE;
		const person = personOf(headers);
		if (!person)
			throw new Refusal("signed-out", "Sign in to approve a device.");
		if (!found.heldBy) {
			throw new Refusal("invalid", "Enter the code first, then approve it.");
		}
		if (found.heldBy !== person) throw new Refusal("forbidden", NOT_YOURS);
		if (found.status !== "pending") {
			throw new Refusal(
				"conflict",
				"Someone used this code already. Start the pairing again on the device.",
			);
		}
		return found;
	};
	const twin = {
		codes,
		tokens,
		async start(deviceId: string, _scope: string) {
			next += 1;
			const code: CodeRecord = {
				deviceCode: `device-code-${next}`,
				userCode: `CODE${String(next).padStart(4, "0")}`,
				deviceId,
				status: "pending",
				heldBy: null,
			};
			codes.push(code);
			return {
				deviceCode: code.deviceCode,
				userCode: code.userCode,
				expiresIn: 900,
				interval: 2,
			};
		},
		async poll(code: { deviceCode: string; deviceId: string }) {
			const found = codes.find(
				(c) => c.deviceCode === code.deviceCode && c.deviceId === code.deviceId,
			);
			if (!found || found.status === "used") return { error: "invalid_grant" };
			if (found.status === "pending") {
				return { error: "authorization_pending" };
			}
			if (found.status === "denied") return { error: "access_denied" };
			found.status = "used";
			const token = `token-${found.deviceCode}`;
			tokens.set(token, found.heldBy ?? "");
			return { token };
		},
		async personOfToken(token: string) {
			return tokens.get(token) ?? null;
		},
		async forgetToken(token: string) {
			tokens.delete(token);
		},
		async verify(headers: Headers, userCode: string) {
			const found = codes.find((c) => c.userCode === userCode);
			if (!found) throw NO_DEVICE;
			const person = personOf(headers);
			found.heldBy ??= person;
			const status = found.status === "used" ? "approved" : found.status;
			return {
				status,
				clientId: person && found.heldBy === person ? found.deviceId : null,
			};
		},
		async approve(headers: Headers, userCode: string) {
			held(headers, userCode).status = "approved";
		},
		async deny(headers: Headers, userCode: string) {
			held(headers, userCode).status = "denied";
		},
	};
	return twin satisfies DeviceAuthorizations;
}

export type InMemoryDeviceAuthorizations = ReturnType<
	typeof inMemoryDeviceAuthorizations
>;

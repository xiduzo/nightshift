import type { Auth } from "../../../../auth";
import type { DeviceAuthorizations } from "../../application/ports";
import { oauthErrorOf, pairingRefusalOf } from "../../domain/pairing";

/** Throws `error` in the Person's words when the plugin refused: for a `.catch`. */
function refuse(error: unknown): never {
	throw pairingRefusalOf(error);
}

/**
 * `DeviceAuthorizations` over Better Auth's device authorization plugin,
 * through `auth.api`. `wirePairing` builds it.
 */
export function betterAuthDeviceAuthorizations(
	auth: Auth,
): DeviceAuthorizations {
	return {
		async start(deviceId, scope) {
			const code = await auth.api.deviceCode({
				body: { client_id: deviceId, scope },
			});
			return {
				deviceCode: code.device_code,
				userCode: code.user_code,
				expiresIn: code.expires_in,
				interval: code.interval,
			};
		},
		async poll(code) {
			try {
				const answer = await auth.api.deviceToken({
					body: {
						grant_type: "urn:ietf:params:oauth:grant-type:device_code",
						device_code: code.deviceCode,
						client_id: code.deviceId,
					},
				});
				return { token: answer.access_token };
			} catch (error) {
				return { error: oauthErrorOf(error) };
			}
		},
		async personOfToken(token) {
			const context = await auth.$context;
			const found = await context.internalAdapter.findSession(token);
			return found?.user.id ?? null;
		},
		async forgetToken(token) {
			const context = await auth.$context;
			await context.internalAdapter.deleteSession(token);
		},
		async verify(headers, userCode) {
			const review = await auth.api
				.deviceVerify({ headers, query: { user_code: userCode } })
				.catch(refuse);
			return { status: review.status, clientId: review.client_id ?? null };
		},
		async approve(headers, userCode) {
			await auth.api
				.deviceApprove({ headers, body: { userCode } })
				.catch(refuse);
		},
		async deny(headers, userCode) {
			await auth.api.deviceDeny({ headers, body: { userCode } }).catch(refuse);
		},
	};
}

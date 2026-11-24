import { createAuthSandbox } from "../../../../testing/sandbox";
import { betterAuthDeviceAuthorizations } from "./better-auth-device-authorizations";
import { deviceAuthorizationsContract } from "./device-authorizations.contract";
import { inMemoryDeviceAuthorizations } from "./in-memory-device-authorizations";

/**
 * The contract of `DeviceAuthorizations`, on both adapters. The real side
 * runs on Better Auth over a fresh database, and waits the plugin's poll
 * interval between two polls.
 */

deviceAuthorizationsContract("in memory", async () => ({
	deviceAuthorizations: inMemoryDeviceAuthorizations(),
	signUp: async (name) => ({
		personId: name.toLowerCase(),
		headers: new Headers({ "x-person": name.toLowerCase() }),
	}),
	wait: async () => {},
	close: async () => {},
}));

deviceAuthorizationsContract("over better-auth", async () => {
	const sandbox = await createAuthSandbox();
	return {
		deviceAuthorizations: betterAuthDeviceAuthorizations(sandbox.auth),
		async signUp(name) {
			const { userId, headers } = await sandbox.signUp(name);
			return { personId: userId, headers };
		},
		wait: () => Bun.sleep(2_050),
		close: async () => sandbox.cleanup(),
	};
});

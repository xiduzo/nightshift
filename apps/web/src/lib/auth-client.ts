import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { SERVER_URL } from "./server-url";

export const authClient = createAuthClient({
	baseURL: SERVER_URL,
	// The sign-in form asks for the code itself (`twoFactorRedirect`).
	plugins: [twoFactorClient()],
});

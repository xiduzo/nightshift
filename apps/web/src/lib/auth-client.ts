import { createAuthClient } from "better-auth/react";

import { SERVER_URL } from "./server-url";

export const authClient = createAuthClient({
	baseURL: SERVER_URL,
});

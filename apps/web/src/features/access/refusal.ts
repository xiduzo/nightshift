import type { QueryClient } from "@tanstack/react-query";

import { isSignInRequired, isTwoFactorRequired } from "@/shared/api";
import { accountQueries } from "./queries";

/**
 * The Host refused the session: nobody is signed in (or the session
 * ended), or two-factor must be on first. Read the account again, and
 * the root sends the person to sign in or to the setup page. No toast.
 * On this computer nobody signs in, so a refusal there still shows.
 * The router gives it to the query client (`createQueryClient`).
 */
export function sendToAccess(client: QueryClient, error: unknown): boolean {
	if (isSignInRequired(error)) {
		const status = client.getQueryData(accountQueries.status().queryKey);
		if (status?.thisComputer) return false;
	} else if (!isTwoFactorRequired(error)) {
		return false;
	}
	void client.invalidateQueries({ queryKey: accountQueries.statusKey() });
	return true;
}

/** The query options of the account: who signed in, and what they must do first. */

import { orpc } from "@/shared/api";

export const accountQueries = {
	/** The person, their two-factor state, and whether this is this computer. */
	status: () => orpc.account.status.queryOptions(),
	/** Every account status query, to read it again. */
	statusKey: () => orpc.account.status.key(),
};

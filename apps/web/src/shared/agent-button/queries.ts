/** The query options of Night Shift's own agents: who answers for each now. */

import { orpc } from "@/shared/api";

export const builtinQueries = {
	/** Each built-in agent with what answers for it on this computer, or why nothing can. */
	agents: () => ({
		...orpc.assistant.agents.queryOptions(),
		// Short: a change in Settings shows when the person comes back.
		staleTime: 5_000,
		// A button works without it: the answer then says what is wrong.
		meta: { quietErrors: true },
	}),
};

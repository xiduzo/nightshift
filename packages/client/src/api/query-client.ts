import { ORPCError } from "@orpc/client";
import {
	MutationCache,
	type Query,
	QueryCache,
	QueryClient,
} from "@tanstack/react-query";

/**
 * How often a query tries again when the Host does not answer, and how
 * long its data stays fresh.
 */
const RETRIES = 3;
const STALE_MS = 60 * 1000;

/**
 * The status codes of a proxy in front of a Host that does not answer
 * (a tunnel, a load balancer): the Host may answer the next try.
 */
const NO_ANSWER_STATUSES = new Set([408, 502, 503, 504]);

/**
 * Whether a failed call may go better the next time: the Host did not
 * answer (no reply, or a proxy that timed out). A refusal of the Host
 * (nobody signed in, not found, not allowed, a bad input) or its own
 * error comes back the same, so the query fails at once and the screen
 * shows it, or sends the person to sign in.
 */
function hostDidNotAnswer(error: unknown): boolean {
	if (!(error instanceof ORPCError)) return true;
	return !error.defined && NO_ANSWER_STATUSES.has(error.status);
}

export type QueryClientOptions = {
	/**
	 * Each error of a query or a mutation, first. True when the app handled
	 * it (it sends the person to sign in), so the error shows nowhere else.
	 */
	handle?: (client: QueryClient, error: unknown) => boolean;
	/**
	 * A query error the person should see. Not one of a query that shows its
	 * own error (`meta.quietErrors`), and not a failed background read of a
	 * query that keeps the data it has (`meta.quietRefetchErrors`).
	 */
	show?: (error: Error, query: Query<unknown, unknown, unknown>) => void;
};

/**
 * Makes the query client of an app, with the rules both apps share: a
 * query tries again only when the Host does not answer, data stays fresh
 * for a minute, and background errors stay quiet. Each app makes its own
 * and holds it.
 */
export function createQueryClient({
	handle,
	show,
}: QueryClientOptions = {}): QueryClient {
	const handled = (error: unknown) => handle?.(client, error) ?? false;
	const client: QueryClient = new QueryClient({
		mutationCache: new MutationCache({
			onError: (error) => {
				handled(error);
			},
		}),
		queryCache: new QueryCache({
			onError: (error, query) => {
				if (handled(error)) return;
				if (query.meta?.quietErrors) return;
				if (query.meta?.quietRefetchErrors && query.state.data !== undefined) {
					return;
				}
				show?.(error, query);
			},
		}),
		defaultOptions: {
			queries: {
				staleTime: STALE_MS,
				retry: (failureCount, error) =>
					failureCount < RETRIES && hostDidNotAnswer(error),
			},
		},
	});
	return client;
}

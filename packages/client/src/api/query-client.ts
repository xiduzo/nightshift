import { ORPCError } from "@orpc/client";
import {
	MutationCache,
	type Query,
	QueryCache,
	QueryClient,
} from "@tanstack/react-query";

import { heldByDocuments } from "../changes";

/**
 * How often a query tries again when the Host does not answer, and how
 * long its data stays fresh.
 */
const RETRIES = 3;
const STALE_MS = 60 * 1000;
/** How long a synced document stays fresh when no item arrives for it. */
const DOCUMENT_MS = 10 * STALE_MS;
/** How long a screen keeps a read it may open again. */
const KEPT_MS = 30 * STALE_MS;

/**
 * Reads the notifications stream marks stale. They stay fresh until then,
 * so opening one shows what the screen already has.
 */
const UNTIL_STREAM: readonly (readonly string[])[] = [
	["gates", "list"],
	["gates", "answered"],
	["runs", "list"],
	["runs", "get"],
	["runs", "step"],
	["runs", "artifacts"],
	["runs", "files"],
];

/**
 * Reads a synced document holds (`heldByDocuments`): the stream marks them
 * stale (`document-changed`), and so does a save on this screen. Ten
 * minutes is the backstop: a Host of an older version sends no item for a
 * document.
 */
const UNTIL_DOCUMENT = heldByDocuments();

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
 * query tries again only when the Host does not answer. A read the stream
 * marks stale stays fresh until then. A synced document stays fresh for
 * ten minutes. Any other read stays fresh for a minute. Background errors
 * stay quiet. Each app makes its own and holds it.
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
	for (const path of UNTIL_STREAM) {
		client.setQueryDefaults([path], {
			staleTime: Number.POSITIVE_INFINITY,
			gcTime: KEPT_MS,
		});
	}
	for (const path of UNTIL_DOCUMENT) {
		client.setQueryDefaults([path], {
			staleTime: DOCUMENT_MS,
			gcTime: KEPT_MS,
		});
	}
	return client;
}

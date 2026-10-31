/** The typed client of a Night Shift, its TanStack Query helpers and query client, the API types and how a call is refused. */

export {
	type ApiTransport,
	createApiClient,
	createQueryUtils,
} from "./client";
export { createQueryClient } from "./query-client";
export {
	isHostUnreachable,
	isMissingOnHost,
	isSignInRequired,
	isTwoFactorRequired,
} from "./refusals";
export type { ApiClient, ApiInputs, ApiOutputs, ApiQueryUtils } from "./types";

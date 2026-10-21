import type { ApiTransport } from "@nightshift/client";
import { fetch as expoFetch } from "expo/fetch";

import type { HostAuthClient } from "./auth-client";

/**
 * How this phone reaches one Host, for `createApiClient` of
 * `@nightshift/client`. It sends the session cookie that the auth client
 * keeps, because React Native has no cookie jar of its own. `expo/fetch`
 * streams a response, so event iterators (a run's live log) work too.
 */
export function hostTransport(
	address: string,
	auth: HostAuthClient,
): ApiTransport {
	return {
		baseUrl: address,
		async fetch(request, init) {
			const hasBody = request.method !== "GET" && request.method !== "HEAD";
			return expoFetch(request.url, {
				...init,
				method: request.method,
				headers: Object.fromEntries(request.headers),
				body: hasBody ? await request.arrayBuffer() : undefined,
				signal: request.signal,
				credentials: "omit",
			}) as unknown as Promise<Response>;
		},
		async headers() {
			const cookie = await auth.getCookie();
			return cookie ? { cookie } : {};
		},
	};
}

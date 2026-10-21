import {
	type ApiClient,
	type ApiQueryUtils,
	createApiClient,
	createQueryUtils,
} from "@nightshift/client";

import {
	createHostAuthClient,
	type HostAuthClient,
	hostTransport,
} from "@/shared/api";

/** One Host as this phone talks to it: its address, its sign-in, its API. */
export type Host = {
	address: string;
	auth: HostAuthClient;
	/** The typed client of the Host. */
	client: ApiClient;
	/** Its query and mutation options, for the `create<Vertical>Queries` factories. */
	orpc: ApiQueryUtils;
};

/**
 * One Host per address for the whole app. The auth client keeps the
 * session cookie in memory too, so a second client of the same Host would
 * miss a sign-in or a sign-out of the first.
 */
const hosts = new Map<string, Host>();

export function hostAt(address: string): Host {
	const known = hosts.get(address);
	if (known) return known;
	const auth = createHostAuthClient(address);
	const client = createApiClient(hostTransport(address, auth));
	const host = { address, auth, client, orpc: createQueryUtils(client) };
	hosts.set(address, host);
	return host;
}

/** The address as the person reads it: `studio.example.com`, without `https://`. */
export function hostLabel(address: string): string {
	return address.replace(/^https:\/\//, "");
}

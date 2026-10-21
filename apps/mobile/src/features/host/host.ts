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

export function hostAt(address: string): Host {
	const auth = createHostAuthClient(address);
	const client = createApiClient(hostTransport(address, auth));
	return { address, auth, client, orpc: createQueryUtils(client) };
}

/** The address as the person reads it: `studio.example.com`, without `https://`. */
export function hostLabel(address: string): string {
	return address.replace(/^https:\/\//, "");
}

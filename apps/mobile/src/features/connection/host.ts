import {
	createHostAuthClient,
	createHostClient,
	type HostAuthClient,
	type HostClient,
} from "@/shared/api";

/** One Host as this phone talks to it: its address, its sign-in, its API. */
export type Host = HostClient & {
	address: string;
	auth: HostAuthClient;
};

export function hostAt(address: string): Host {
	const auth = createHostAuthClient(address);
	return { address, auth, ...createHostClient(address, auth) };
}

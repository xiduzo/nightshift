import { HostUnreachableError } from "@nightshift/engine";
import type { HostClient } from "../../../../contract";
import type { HostCalls } from "../../application/ports";

/**
 * The Hosts of a test: each a client by its id, and the home Host. Records
 * each call it was asked, with its options.
 */
export function inMemoryHostCalls() {
	let homeHost: { hostId: string; personId: string } | null = null;
	const hosts = new Map<string, unknown>();
	const asked: { hostId: string; deadlineMs: number }[] = [];
	const twin = {
		hosts,
		asked,
		/** A Host this computer has a link to: its client (only the calls a test needs). */
		addHost(hostId: string, client: unknown) {
			hosts.set(hostId, client);
		},
		setHome(home: { hostId: string; personId: string } | null) {
			homeHost = home;
		},
		async home() {
			return homeHost;
		},
		async ask<T>(
			hostId: string,
			onHost: (client: HostClient) => Promise<T>,
			options: { deadlineMs: number },
		): Promise<T> {
			asked.push({ hostId, ...options });
			const client = hosts.get(hostId);
			if (!client) throw new HostUnreachableError();
			return onHost(client as HostClient);
		},
	};
	return twin satisfies HostCalls;
}

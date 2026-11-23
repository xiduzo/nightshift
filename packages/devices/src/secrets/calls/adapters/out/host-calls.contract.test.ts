import type { HostClient } from "../../../../contract";
import { hostCallsContract } from "./host-calls.contract";
import { inMemoryHostCalls } from "./in-memory-host-calls";
import { linkHostCalls } from "./link-host-calls";

/** The contract of `HostCalls`, on both adapters. The real one runs on links that call a client at once. */

hostCallsContract("in memory", async () => {
	const hostCalls = inMemoryHostCalls();
	return {
		hostCalls,
		addHost: hostCalls.addHost,
		setHome: hostCalls.setHome,
	};
});

hostCallsContract("over links", async () => {
	let home: { hostId: string; personId: string } | null = null;
	const clients = new Map<string, unknown>();
	const hostCalls = linkHostCalls({
		hostLinks: {
			home: async () =>
				home
					? ({ ...home, name: "Host" } as unknown as Awaited<
							ReturnType<
								Parameters<typeof linkHostCalls>[0]["hostLinks"]["home"]
							>
						>)
					: null,
		},
		links: () => ({
			get: (hostId: string) => {
				const client = clients.get(hostId);
				if (!client) return undefined;
				return {
					call: <T>(
						use: (client: HostClient, signal: AbortSignal) => Promise<T>,
					) => use(client as HostClient, new AbortController().signal),
				} as unknown as ReturnType<
					ReturnType<Parameters<typeof linkHostCalls>[0]["links"]>["get"]
				>;
			},
		}),
	});
	return {
		hostCalls,
		addHost: (hostId, client) => clients.set(hostId, client),
		setHome: (next) => {
			home = next;
		},
	};
});

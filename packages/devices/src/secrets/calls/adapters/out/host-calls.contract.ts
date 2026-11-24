import { describe, expect, test } from "bun:test";
import { HostUnreachableError } from "@nightshift/engine";
import type { HostClient } from "../../../../contract";
import type { HostCalls } from "../../application/ports";

/** One adapter of `HostCalls` to test, with the Hosts it has links to. */
export type HostCallsUnderTest = {
	hostCalls: HostCalls;
	/** A Host with a link here: its client. */
	addHost(hostId: string, client: unknown): void;
	setHome(home: { hostId: string; personId: string } | null): void;
};

const OPTIONS = { deadlineMs: 1_000 };

/**
 * What every adapter of `HostCalls` does.
 * `host-calls.contract.test.ts` runs it on the in-memory adapter and on
 * the real one.
 */
export function hostCallsContract(
	name: string,
	make: () => Promise<HostCallsUnderTest>,
): void {
	describe(`HostCalls contract: ${name}`, () => {
		test("without a home Host, there is none", async () => {
			const under = await make();
			expect(await under.hostCalls.home()).toBeNull();
		});

		test("the home Host, with the Person it knows the owner as", async () => {
			const under = await make();
			under.setHome({ hostId: "host-1", personId: "person-ada" });
			expect(await under.hostCalls.home()).toEqual({
				hostId: "host-1",
				personId: "person-ada",
			});
		});

		test("a call reaches the Host's client and gives its answer", async () => {
			const under = await make();
			under.addHost("host-1", { secrets: { list: async () => ["A_TOKEN"] } });
			const answer = await under.hostCalls.ask(
				"host-1",
				(client: HostClient) => client.secrets.list(),
				OPTIONS,
			);
			expect(answer as unknown).toEqual(["A_TOKEN"]);
		});

		test("a Host without a link here cannot be reached", async () => {
			const under = await make();
			await expect(
				under.hostCalls.ask("host-1", async () => null, OPTIONS),
			).rejects.toBeInstanceOf(HostUnreachableError);
		});
	});
}

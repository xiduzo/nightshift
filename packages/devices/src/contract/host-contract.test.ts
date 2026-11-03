import { describe, expect, test } from "bun:test";
import { hostContract } from "./host-contract";

/**
 * The Host's contract is the wire format between daemons of different
 * versions: a Host from main serves Devices of older builds, which call
 * these paths with these Device key permissions.
 */

const procedures = Object.entries(hostContract).flatMap(([group, entries]) =>
	Object.entries(entries).map(
		([name, procedure]) => [`${group}.${name}`, procedure] as const,
	),
);

describe("the Host's contract", () => {
	test("keeps the paths older Devices call", () => {
		expect(procedures.map(([path]) => path)).toEqual([
			"link.hello",
			"link.heartbeat",
			"link.phones",
			"link.removePhone",
			"link.leave",
			"pairing.start",
			"pairing.redeem",
			"sync.pull",
			"sync.stream",
			"sync.push",
			"sync.command",
			"sync.commandDone",
			"sync.commands",
			"sync.startRun",
			"sync.devices",
			"sync.offer",
			"sync.withdrawOffer",
			"sync.addProject",
			"sync.addClone",
			"sync.mergePersonal",
			"leases.take",
			"leases.renew",
			"leases.release",
			"archive.put",
			"archive.get",
			"archive.knowledgePut",
			"archive.knowledgeGet",
			"archive.follow",
			"archive.tail",
			// ADR 13: an older Host has none, and the Device says to update it.
			"secrets.list",
			"secrets.values",
			"secrets.set",
			"secrets.remove",
			"secrets.moveOnDevice",
			"projectSecrets.list",
			"projectSecrets.values",
			"projectSecrets.set",
			"projectSecrets.remove",
			"projectSecrets.take",
			"devices.work",
			"devices.call",
			"devices.reachable",
			"devices.workReply",
		]);
	});

	test("names the Device key permission of every procedure but pairing", () => {
		const keys = Object.fromEntries(
			procedures.map(([path, procedure]) => [
				path,
				procedure["~orpc"].meta.key ?? null,
			]),
		);
		for (const [path, key] of Object.entries(keys)) {
			const group = path.split(".")[0];
			const expected =
				group === "pairing"
					? null
					: group === "archive"
						? "archive"
						: group === "devices"
							? "relay"
							: "sync";
			expect(key, path).toBe(expected);
		}
	});

	test("gives every procedure a one-line summary and an output schema", () => {
		for (const [path, procedure] of procedures) {
			const { route, outputSchema } = procedure["~orpc"];
			expect(route.summary, path).toBeString();
			expect(route.summary?.includes("\n"), path).toBe(false);
			expect(outputSchema, path).toBeDefined();
		}
	});
});

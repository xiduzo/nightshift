import { describe, expect, test } from "bun:test";
import { hostContract } from "./host-contract";
import { commandBatchSchema } from "./sync";

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
			// ADR 27: an older Host has none, and the Device says to update it.
			"sync.startTest",
			"sync.devices",
			"sync.offer",
			"sync.withdrawOffer",
			"sync.addProject",
			"sync.addWithoutFolder",
			"sync.addClone",
			"sync.setClones",
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
			"spaceSecrets.list",
			"spaceSecrets.set",
			"spaceSecrets.remove",
			"spaceSecrets.take",
			"devices.work",
			"devices.call",
			"devices.stop",
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

	test("keeps the Command shapes older Devices send, and reads back", async () => {
		// Each kind, with every field an older Device may send, as it sent it.
		const older = [
			{
				kind: "gate.resolve",
				payload: {
					stepId: "step-1",
					choice: "approve",
					note: "Looks right.",
					data: { variant: "calm" },
					files: [
						{ name: "note.md", mediaType: "text/markdown", content: "aGk=" },
					],
					via: "lock_screen",
				},
			},
			{ kind: "signal.send", payload: { name: "deploy-done" } },
			{ kind: "run.stop", payload: {} },
			{ kind: "run.stop", payload: { when: "cancel-after-step" } },
			{ kind: "run.move", payload: { to: "laptop" } },
			{ kind: "run.resume", payload: {} },
			{ kind: "run.resume", payload: { prompt: "Go on." } },
			{ kind: "lease.release", payload: { name: "docker" } },
			{ kind: "run.useful", payload: { useful: false } },
		];
		const input = hostContract.sync.command["~orpc"].inputSchema;
		expect(input).toBeDefined();
		for (const command of older) {
			const sent = { runId: "run-1", ...command };
			const result = await input?.["~standard"].validate(sent);
			expect(
				result && "issues" in result ? result.issues : undefined,
				command.kind,
			).toBeUndefined();
		}
		const kept = {
			id: "command-1",
			spaceId: "space-1",
			runId: "run-1",
			walkerId: "laptop",
			personId: "person-1",
			createdAt: 1_700_000_000_000,
		};
		const batch = commandBatchSchema.safeParse({
			commands: older.map((command) => ({ ...kept, ...command })),
		});
		expect(batch.error?.issues).toBeUndefined();
	});
});

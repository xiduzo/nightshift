import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { member, user } from "@nightshift/db/schema";
import { asDate } from "@nightshift/time";
import {
	createSandbox,
	otherSpace,
	type Sandbox,
} from "../testing/test-support";
import { inboxOf, inboxOrder, lockScreenRefusal } from "./inbox";
import type { OpenGate } from "./views";

/** An open Gate of a run in a Space, opened at `openedAt`. */
function openGate(
	spaceId: string,
	runId: string,
	openedAt: number,
	stepId = `step-${runId}`,
): OpenGate {
	return {
		spaceId,
		runId,
		runTitle: `Run ${runId}`,
		flowName: null,
		projectId: `project-${runId}`,
		projectName: "Project",
		stepId,
		nodeId: "ship",
		question: "Ship it?",
		choices: [{ name: "yes" }, { name: "no" }],
		lockScreen: false,
		openedAt,
		deadline: null,
		form: null,
		walker: { id: "device", name: "test", thisDevice: true },
		answerPending: false,
	};
}

describe("inboxOrder", () => {
	test("puts the Gate that has waited longest first", () => {
		const gates = [openGate("s", "b", 20), openGate("s", "a", 10)];
		expect(inboxOrder(gates).map((gate) => gate.runId)).toEqual(["a", "b"]);
		// It leaves the list it was given as it was.
		expect(gates.map((gate) => gate.runId)).toEqual(["b", "a"]);
	});

	test("keeps one order for Gates that opened at the same moment", () => {
		const gates = [
			openGate("s", "b", 5, "s1"),
			openGate("s", "a", 5, "s2"),
			openGate("s", "a", 5, "s1"),
		];
		expect(
			inboxOrder(gates).map((gate) => `${gate.runId}:${gate.stepId}`),
		).toEqual(["a:s1", "a:s2", "b:s1"]);
	});
});

describe("inboxOf", () => {
	let sandbox: Sandbox;
	beforeEach(async () => {
		sandbox = await createSandbox();
	});
	afterEach(async () => {
		await sandbox.cleanup();
	});

	test("lists the open Gates of every Space the Person is in, in one order, with each Space's name and whether they may answer", async () => {
		const platform = await otherSpace(sandbox.db, "Platform");
		const docs = await otherSpace(sandbox.db, "Docs");
		const elsewhere = await otherSpace(sandbox.db, "Elsewhere");
		await sandbox.db
			.insert(user)
			.values({ id: "u-ada", name: "Ada", email: "ada@example.com" });
		await sandbox.db.insert(member).values([
			{
				id: "m1",
				organizationId: platform,
				userId: "u-ada",
				role: "member",
				createdAt: asDate(),
			},
			{
				id: "m2",
				organizationId: docs,
				userId: "u-ada",
				role: "viewer",
				createdAt: asDate(),
			},
		]);
		const gatesIn = new Map([
			[platform, [openGate(platform, "platform-late", 30)]],
			[docs, [openGate(docs, "docs-early", 10)]],
			[elsewhere, [openGate(elsewhere, "not-hers", 1)]],
		]);
		const asked: string[] = [];
		const engine = {
			space: (spaceId: string, actor: { personId: string }) => ({
				listGates: async () => {
					asked.push(`${spaceId}:${actor.personId}`);
					return gatesIn.get(spaceId) ?? [];
				},
			}),
		};

		const inbox = await inboxOf({ db: sandbox.db, engine }, "u-ada");
		expect(
			inbox.map((gate) => [gate.runId, gate.spaceName, gate.canAnswer]),
		).toEqual([
			["docs-early", "Docs", false],
			["platform-late", "Platform", true],
		]);
		// Each Space is read in the Person's name; a Space they are not in is not read.
		expect(asked.sort()).toEqual([`${docs}:u-ada`, `${platform}:u-ada`]);
	});
});

describe("lockScreenRefusal", () => {
	const marked = { ...openGate("s", "marked", 1), lockScreen: true };
	const plain = openGate("s", "plain", 2);
	const answer = (runId: string, choice = "yes") => ({
		runId,
		stepId: `step-${runId}`,
		choice,
	});

	test("takes an answer for a Gate its author marked for the lock screen, with one of its choices", () => {
		expect(lockScreenRefusal([marked, plain], answer("marked"))).toBeNull();
	});

	test("needs the app for a Gate not marked for it, or a choice it does not have", () => {
		expect(lockScreenRefusal([marked, plain], answer("plain"))).toBe(
			"needs-app",
		);
		expect(
			lockScreenRefusal([marked], answer("marked", "approve-deploy")),
		).toBe("needs-app");
	});

	test("refuses a Gate that is not open, or has an answer on its way, as closed", () => {
		expect(lockScreenRefusal([plain], answer("marked"))).toBe("gate-closed");
		// Another step of the same run is not this Gate.
		expect(
			lockScreenRefusal([marked], { ...answer("marked"), stepId: "other" }),
		).toBe("gate-closed");
		expect(
			lockScreenRefusal([{ ...marked, answerPending: true }], answer("marked")),
		).toBe("gate-closed");
	});
});

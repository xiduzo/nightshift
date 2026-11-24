import { expect, test } from "bun:test";
import type { WorkRelay, WorkRequest } from "../../../contract";
import { createOfferedSessions } from "./offered-sessions";

test("a run counts under an Offer while its session names that profile, on that Device, in that Space", async () => {
	const sessions = createOfferedSessions();
	const relay = sessions.relay({
		async *call() {
			yield { kind: "item", item: "ready" };
			await new Promise(() => {});
		},
		online: () => true,
	} satisfies WorkRelay);
	const session: WorkRequest = {
		spaceId: "team",
		projectId: "p1",
		personId: "ada",
		runId: "run-1",
		call: {
			kind: "session",
			input: {
				cwd: "/work",
				prompt: "Go.",
				offered: { profile: "profile-1" },
			},
		},
	};
	await relay.call("laptop", session)[Symbol.asyncIterator]().next();
	const offer = { spaceId: "team", deviceId: "laptop", profile: "profile-1" };
	expect(sessions.runsUnder(offer)).toEqual(["run-1"]);
	for (const other of [
		{ ...offer, spaceId: "other" },
		{ ...offer, deviceId: "desktop" },
		{ ...offer, profile: "coder" },
	]) {
		expect(sessions.runsUnder(other)).toEqual([]);
	}
});

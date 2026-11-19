import { describe, expect, test } from "bun:test";
import { FLOW_VERSION } from "@nightshift/flows";
import type { OwnDevice } from "../../../contract";
import { RunRefusal } from "../../../run-status";
import {
	movable,
	NO_CHECKPOINT,
	notYourDevice,
	refuseMoveHere,
	signedOut,
	snapshotVersion,
	walksThere,
} from "./move-rules";

/** The rules of a move of a run's walk, past its status. */

/** What a rule throws, or null. */
function refusalOf(rule: () => void): RunRefusal | null {
	try {
		rule();
		return null;
	} catch (error) {
		if (error instanceof RunRefusal) return error;
		throw error;
	}
}

describe("a move to this computer", () => {
	const here = { walkerId: "walker-here", deviceId: "device-here" };

	test("is refused, as the Walker of its runs and as a Device", () => {
		for (const to of [here.walkerId, here.deviceId]) {
			const refused = refusalOf(() => refuseMoveHere(to, here));
			expect(refused?.rule).toBe("walks-here");
			expect(refused?.message).toBe("This run already runs on this computer.");
		}
	});

	test("lets a move to another Device through", () => {
		expect(refusalOf(() => refuseMoveHere("laptop", here))).toBeNull();
	});
});

test("the refusals of a move have their words", () => {
	expect(notYourDevice().rule).toBe("not-your-device");
	expect(notYourDevice().message).toBe("That device is not one of yours.");
	expect(signedOut().rule).toBe("signed-out");
	expect(signedOut().message).toBe("Sign in to act on this run.");
	expect(NO_CHECKPOINT).toBe("The archive has no checkpoint of the run.");
});

describe("the flow format of a run", () => {
	const flow = (version?: number) =>
		JSON.stringify(version === undefined ? {} : { version });

	test("is the newest of its flow and the flows it calls", () => {
		expect(
			snapshotVersion({
				flow: flow(7),
				bodyFlows: JSON.stringify({ sub: { version: 9 } }),
			}),
		).toBe(9);
		expect(snapshotVersion({ flow: flow(9), bodyFlows: "{}" })).toBe(9);
	});

	test("is this build's for a flow that names none, or a snapshot that does not read", () => {
		expect(snapshotVersion({ flow: flow(), bodyFlows: "{}" })).toBe(
			FLOW_VERSION,
		);
		expect(snapshotVersion({ flow: "not json", bodyFlows: "{}" })).toBe(
			FLOW_VERSION,
		);
	});
});

describe("a Device walks a run there", () => {
	const run = { flowVersion: 9, test: false };

	test("when it reads the run's flows", () => {
		expect(walksThere({ flowVersion: 9, testRuns: false }, run)).toBe(true);
		expect(walksThere({ flowVersion: 10, testRuns: false }, run)).toBe(true);
		expect(walksThere({ flowVersion: 8, testRuns: true }, run)).toBe(false);
	});

	test("a test run only when it walks test runs (ADR 27)", () => {
		const tested = { ...run, test: true };
		expect(walksThere({ flowVersion: 9, testRuns: true }, tested)).toBe(true);
		expect(walksThere({ flowVersion: 9, testRuns: false }, tested)).toBe(false);
	});
});

describe("the Devices a run can move to", () => {
	const device = (
		deviceId: string,
		fields: Partial<OwnDevice> = {},
	): OwnDevice => ({
		deviceId,
		name: deviceId,
		thisDevice: false,
		online: true,
		hasClone: true,
		...fields,
	});
	const devices = [
		device("here", { thisDevice: true }),
		device("laptop"),
		device("desk", { online: false }),
		device("theirs", { offers: [] }),
	];

	test("are the Person's own, online, never its Walker nor this computer while it walks the run", () => {
		expect(
			movable(devices, { walkerId: "here" }, true).map((d) => d.deviceId),
		).toEqual(["laptop"]);
	});

	test("include this computer once another Device walks the run", () => {
		expect(
			movable(devices, { walkerId: "laptop" }, false).map((d) => d.deviceId),
		).toEqual(["here"]);
	});
});

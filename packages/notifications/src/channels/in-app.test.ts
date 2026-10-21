import { expect, test } from "bun:test";

import { createInAppChannel, type InAppItem } from "./in-app";

const message = {
	key: "run-1:step-1",
	kind: "gate-opened" as const,
	spaceId: "space-1",
	runId: "run-1",
	stepId: "step-1",
	title: "A Gate waits for you",
	alert: true,
	count: null,
	at: 1,
};

test("each open stream of the Person gets each item; a closed one stays active a moment", async () => {
	let clock = 1_000;
	const inApp = createInAppChannel({ now: () => clock, recentMs: 60_000 });
	expect(inApp.isActive("ada")).toBe(false);

	const stop = new AbortController();
	const got: InAppItem[] = [];
	const done = (async () => {
		for await (const item of inApp.watch("ada", stop.signal)) got.push(item);
	})();
	expect(inApp.isActive("ada")).toBe(true);

	await inApp.send({ kind: "in-app", personId: "ada" }, message);
	await inApp.send({ kind: "in-app", personId: "bob" }, message);
	await inApp.withdraw({ kind: "in-app", personId: "ada" }, "run-1:step-1");
	await new Promise((resolve) => setTimeout(resolve, 0));

	expect(got).toEqual([
		{
			kind: "gate-opened",
			key: "run-1:step-1",
			spaceId: "space-1",
			runId: "run-1",
			stepId: "step-1",
			title: "A Gate waits for you",
			alert: true,
			at: 1,
		},
		{
			kind: "gate-closed",
			key: "run-1:step-1",
			runId: "run-1",
			stepId: "step-1",
			at: 1_000,
		},
	]);

	stop.abort();
	await done;
	expect(inApp.isActive("ada")).toBe(true);
	clock += 60_000;
	expect(inApp.isActive("ada")).toBe(false);
});

test("a stream from this computer makes the Person active here; one from elsewhere does not", async () => {
	let clock = 1_000;
	const inApp = createInAppChannel({ now: () => clock, recentMs: 60_000 });
	const drain = async (stream: AsyncGenerator<InAppItem>) => {
		for await (const _ of stream) {
		}
	};

	const phone = new AbortController();
	const phoneDone = drain(inApp.watch("ada", phone.signal));
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(inApp.isActive("ada")).toBe(true);
	expect(inApp.isActiveHere("ada")).toBe(false);

	const window = new AbortController();
	const windowDone = drain(inApp.watch("ada", window.signal, { here: true }));
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(inApp.isActiveHere("ada")).toBe(true);
	expect(inApp.isActiveHere("bob")).toBe(false);

	window.abort();
	await windowDone;
	expect(inApp.isActiveHere("ada")).toBe(true);
	clock += 60_000;
	expect(inApp.isActiveHere("ada")).toBe(false);

	phone.abort();
	await phoneDone;
});

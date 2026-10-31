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

test("the phone app counts as open while its stream is, and closed once it leaves the front", async () => {
	let clock = 1_000;
	const inApp = createInAppChannel({ now: () => clock, recentMs: 60_000 });
	const stop = new AbortController();
	const done = (async () => {
		for await (const _ of inApp.watch("ada", stop.signal, { phone: true })) {
		}
	})();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(inApp.isActive("ada")).toBe(true);

	stop.abort();
	await done;
	clock += 1;
	expect(inApp.isActive("ada")).toBe(false);
});

test("a run that changed reaches each open stream of the Person, with no key and no alert", async () => {
	const inApp = createInAppChannel({ now: () => 5 });
	const stop = new AbortController();
	const got: InAppItem[] = [];
	const done = (async () => {
		for await (const item of inApp.watch("ada", stop.signal)) got.push(item);
	})();
	inApp.runChanged(
		{ kind: "in-app", personId: "ada" },
		{ spaceId: "space-1", runId: "run-1" },
	);
	inApp.runChanged(
		{ kind: "in-app", personId: "bob" },
		{ spaceId: "space-1", runId: "run-2" },
	);
	inApp.learningsChanged(
		{ kind: "in-app", personId: "ada" },
		{ spaceId: "space-1", projectId: "p1" },
	);
	await new Promise((resolve) => setTimeout(resolve, 0));
	stop.abort();
	await done;

	expect(got).toEqual([
		{ kind: "run-changed", spaceId: "space-1", runId: "run-1", at: 5 },
		{ kind: "learnings-changed", spaceId: "space-1", projectId: "p1", at: 5 },
	]);
});

test("a project's schedules that changed reach only that Person's open streams", async () => {
	const inApp = createInAppChannel({ now: () => 7 });
	const stop = new AbortController();
	const got: InAppItem[] = [];
	const done = (async () => {
		for await (const item of inApp.watch("ada", stop.signal)) got.push(item);
	})();
	inApp.schedulesChanged(
		{ kind: "in-app", personId: "ada" },
		{ spaceId: "space-1", projectId: "p1" },
	);
	inApp.schedulesChanged(
		{ kind: "in-app", personId: "bob" },
		{ spaceId: "space-1", projectId: "p2" },
	);
	await new Promise((resolve) => setTimeout(resolve, 0));
	stop.abort();
	await done;

	expect(got).toEqual([
		{ kind: "schedules-changed", spaceId: "space-1", projectId: "p1", at: 7 },
	]);
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

test("a device wait that is over reaches the open streams as wait-ended", async () => {
	const inApp = createInAppChannel({ now: () => 5 });
	const stop = new AbortController();
	const got: InAppItem[] = [];
	const done = (async () => {
		for await (const item of inApp.watch("ada", stop.signal)) got.push(item);
	})();

	await inApp.send(
		{ kind: "in-app", personId: "ada" },
		{
			...message,
			kind: "device-wait",
			key: "run-1:wait:step-1",
			title: "Triage waits for studio-mac",
			body: "The step starts when the device is back.",
		},
	);
	await inApp.withdraw(
		{ kind: "in-app", personId: "ada" },
		"run-1:wait:step-1",
	);
	await inApp.withdraw({ kind: "in-app", personId: "ada" }, "run-1:end:3");
	await new Promise((resolve) => setTimeout(resolve, 0));

	expect(got).toEqual([
		{
			kind: "device-wait",
			key: "run-1:wait:step-1",
			spaceId: "space-1",
			runId: "run-1",
			stepId: "step-1",
			title: "Triage waits for studio-mac",
			body: "The step starts when the device is back.",
			alert: true,
			at: 1,
		},
		{
			kind: "wait-ended",
			key: "run-1:wait:step-1",
			runId: "run-1",
			stepId: "step-1",
			at: 5,
		},
	]);
	stop.abort();
	await done;
});

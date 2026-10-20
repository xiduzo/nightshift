import { expect, test } from "bun:test";

import { notifySystemd } from "./systemd";

test("outside systemd, nothing is sent", () => {
	const sent: string[][] = [];
	expect(
		notifySystemd({ env: {}, spawn: (command) => sent.push(command) }),
	).toBeNull();
	expect(sent).toEqual([]);
});

test("under systemd: ready at once, then a watchdog ping at half the watchdog time", async () => {
	const sent: string[][] = [];
	const timer = notifySystemd({
		env: { NOTIFY_SOCKET: "/run/systemd/notify", WATCHDOG_USEC: "100000" },
		spawn: (command) => sent.push(command),
	});
	expect(sent).toEqual([["systemd-notify", "--ready"]]);
	await Bun.sleep(230);
	clearInterval(timer as Timer);
	const pings = sent.slice(1);
	expect(pings.length).toBeGreaterThanOrEqual(2);
	expect(new Set(pings.map((command) => command.join(" ")))).toEqual(
		new Set(["systemd-notify WATCHDOG=1"]),
	);
});

test("without a watchdog, only ready is sent", () => {
	const sent: string[][] = [];
	expect(
		notifySystemd({
			env: { NOTIFY_SOCKET: "/run/systemd/notify" },
			spawn: (command) => sent.push(command),
		}),
	).toBeNull();
	expect(sent).toEqual([["systemd-notify", "--ready"]]);
});

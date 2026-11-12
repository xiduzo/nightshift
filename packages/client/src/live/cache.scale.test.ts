import { afterEach, describe, expect, test } from "bun:test";
import {
	InfiniteQueryObserver,
	type InfiniteQueryObserverOptions,
	QueryObserver,
	type QueryObserverOptions,
} from "@tanstack/react-query";
import { createApiClient, createQueryUtils } from "../api";
import { createQueryClient } from "../api/query-client";
import type {
	NotificationItem,
	NotificationWatchClient,
} from "../notifications";
import { createRunQueries } from "../runs";
import { createLiveCache } from "./cache";
import type { Schedule } from "./run-buffer";
import type { ShownNotifications } from "./shown";

/**
 * Scale of one burst of run updates. Many events in one moment read the
 * open lists once. A run that is not on screen is not read again. A long
 * list refetches each page it already holds, not the square of them.
 */

function handSchedule() {
	const waiting: { run: () => void; ms: number }[] = [];
	const schedule: Schedule = (run, ms) => {
		const item = { run, ms };
		waiting.push(item);
		return () => {
			const at = waiting.indexOf(item);
			if (at >= 0) waiting.splice(at, 1);
		};
	};
	const due = (ms: number) => {
		for (const item of waiting.filter((one) => one.ms === ms)) {
			waiting.splice(waiting.indexOf(item), 1);
			item.run();
		}
	};
	return { schedule, due };
}

const calls: string[] = [];

const orpc = createQueryUtils(
	createApiClient({
		link: {
			call: (path, input) => {
				const name = path.join(".");
				calls.push(name);
				if (name !== "runs.list") return Promise.resolve({ id: "hot" });
				const cursor = (input as { cursor?: { id: string } } | undefined)
					?.cursor;
				const index = cursor ? Number(cursor.id.slice(1)) + 1 : 0;
				return Promise.resolve([
					{ id: `p${index}`, createdAt: 1_000_000 - index },
				]);
			},
		},
	}),
);

const runs = createRunQueries(orpc);

function changed(runId: string): NotificationItem {
	return { kind: "run-changed", spaceId: "s1", runId, at: 3 };
}

function fakeHost() {
	const controller = new AbortController();
	const queue: NotificationItem[][] = [];
	let wake: (() => void) | null = null;
	const client: NotificationWatchClient = {
		notifications: {
			async watch() {
				return (async function* () {
					while (!controller.signal.aborted) {
						const items = queue.shift();
						if (items) {
							yield* items;
							continue;
						}
						await new Promise<void>((resolve) => {
							wake = resolve;
						});
					}
				})();
			},
		},
	};
	return {
		client,
		signal: controller.signal,
		async send(...items: NotificationItem[]) {
			queue.push(items);
			wake?.();
			await Bun.sleep(0);
		},
		stop() {
			controller.abort();
			wake?.();
		},
	};
}

const screen: ShownNotifications = {
	show: () => {},
	close: () => {},
	list: async () => [],
};

const hosts: ReturnType<typeof fakeHost>[] = [];
afterEach(() => {
	for (const host of hosts.splice(0)) host.stop();
});

async function idle(client: ReturnType<typeof createQueryClient>) {
	for (let i = 0; i < 30 && client.isFetching() > 0; i++) await Bun.sleep(0);
}

describe("a burst of run updates", () => {
	test("reads the open list once, and only the run that is on screen", async () => {
		const queryClient = createQueryClient();
		await queryClient.fetchQuery(runs.everyRun());
		await queryClient.fetchQuery(runs.get("hot"));
		for (let i = 0; i < 400; i++) {
			queryClient.setQueryData(
				runs.get(`r${i}`).queryKey as readonly unknown[],
				{ id: `r${i}` },
			);
		}
		const list = new QueryObserver(
			queryClient,
			runs.everyRun() as QueryObserverOptions,
		);
		const detail = new QueryObserver(
			queryClient,
			runs.get("hot") as QueryObserverOptions,
		);
		const stopList = list.subscribe(() => {});
		const stopDetail = detail.subscribe(() => {});
		calls.length = 0;

		const timers = handSchedule();
		const live = createLiveCache({
			queryClient,
			orpc,
			schedule: timers.schedule,
		});
		const host = fakeHost();
		hosts.push(host);
		const followed = live.followHost({
			client: host.client,
			shown: screen,
			signal: host.signal,
		});
		await Bun.sleep(0);
		const started = performance.now();
		await host.send(
			...Array.from({ length: 40 }, (_, i) =>
				changed(i === 0 ? "hot" : `r${i}`),
			),
		);
		timers.due(300);
		await idle(queryClient);
		expect(performance.now() - started).toBeLessThan(500);
		expect(calls.filter((name) => name === "runs.list")).toHaveLength(1);
		expect(calls.filter((name) => name === "runs.get")).toHaveLength(1);

		stopList();
		stopDetail();
		host.stop();
		await followed;
	}, 20_000);

	test("refetches each loaded page of a run list, not the square of them", async () => {
		const queryClient = createQueryClient();
		const options = runs.pages({}, 1);
		const pageCount = 8;
		const pages = [];
		const pageParams: ({ id: string; createdAt: number } | undefined)[] = [
			undefined,
		];
		for (let i = 0; i < pageCount; i++) {
			pages.push([{ id: `p${i}`, createdAt: 1_000_000 - i }]);
			if (i < pageCount - 1) {
				pageParams.push({ id: `p${i}`, createdAt: 1_000_000 - i });
			}
		}
		queryClient.setQueryData(options.queryKey as readonly unknown[], {
			pages,
			pageParams,
		});
		const observer = new InfiniteQueryObserver(
			queryClient,
			options as InfiniteQueryObserverOptions,
		);
		const stop = observer.subscribe(() => {});
		calls.length = 0;

		const timers = handSchedule();
		const live = createLiveCache({
			queryClient,
			orpc,
			schedule: timers.schedule,
		});
		const host = fakeHost();
		hosts.push(host);
		const followed = live.followHost({
			client: host.client,
			shown: screen,
			signal: host.signal,
		});
		await Bun.sleep(0);
		await host.send(changed("hot"));
		timers.due(300);
		await idle(queryClient);
		const lists = calls.filter((name) => name === "runs.list").length;
		expect(lists).toBe(pageCount);
		expect(lists).toBeLessThan(pageCount * pageCount);

		stop();
		host.stop();
		await followed;
	}, 20_000);
});

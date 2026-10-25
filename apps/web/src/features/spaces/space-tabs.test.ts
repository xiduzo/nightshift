import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import { createSpaceTabs } from "./space-tabs";

/** The projects of the active Space, keyed like a procedure of the Host. */
const PROJECTS = [["projects", "list"], { type: "query" }];

/** Two tabs of one browser: each its own cache and its own channel, one session. */
function twoTabs() {
	const name = `space-tabs-${crypto.randomUUID()}`;
	const tab = () => {
		const channel = new BroadcastChannel(name);
		const queryClient = new QueryClient();
		// Each tab shows the projects of the Space it works in.
		queryClient.setQueryData(PROJECTS, ["Space A's project"]);
		return { channel, queryClient, tabs: createSpaceTabs(() => channel) };
	};
	return [tab(), tab()] as const;
}

/** Whether a tab still holds the projects of the Space before. */
const holdsOldSpace = (queryClient: QueryClient) =>
	queryClient.getQueryData(PROJECTS) !== undefined;

let opened: BroadcastChannel[] = [];
afterEach(() => {
	for (const channel of opened) channel.close();
	opened = [];
});

describe("the tabs of one browser", () => {
	test("a Space switch in one tab makes every tab forget the Space before", async () => {
		const [here, there] = twoTabs();
		opened = [here.channel, there.channel];
		const stop = there.tabs.follow(there.queryClient);

		await here.tabs.changed(here.queryClient);
		expect(holdsOldSpace(here.queryClient)).toBe(false);
		// The other tab hears it on its own channel, a moment later.
		for (let i = 0; i < 50 && holdsOldSpace(there.queryClient); i++) {
			await Bun.sleep(10);
		}
		expect(holdsOldSpace(there.queryClient)).toBe(false);
		stop();
	});

	test("a tab that stopped following keeps its cache", async () => {
		const [here, there] = twoTabs();
		opened = [here.channel, there.channel];
		there.tabs.follow(there.queryClient)();

		await here.tabs.changed(here.queryClient);
		await Bun.sleep(50);
		expect(holdsOldSpace(there.queryClient)).toBe(true);
	});

	test("without a channel, the tab still forgets the Space before", async () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(PROJECTS, []);
		const tabs = createSpaceTabs(() => null);
		expect(tabs.follow(queryClient)).toBeFunction();
		await tabs.changed(queryClient);
		expect(holdsOldSpace(queryClient)).toBe(false);
	});
});

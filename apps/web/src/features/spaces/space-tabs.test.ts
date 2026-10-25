import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import { createSpaceTabs } from "./space-tabs";

/** Two tabs of one browser: each its own cache and its own channel, one session. */
function twoTabs() {
	const name = `space-tabs-${crypto.randomUUID()}`;
	const tab = () => {
		const channel = new BroadcastChannel(name);
		const queryClient = new QueryClient();
		// Each tab shows the projects of the Space it works in.
		queryClient.setQueryData(["projects", "list"], ["Space A's project"]);
		return { channel, queryClient, tabs: createSpaceTabs(() => channel) };
	};
	return [tab(), tab()] as const;
}

const projectsOf = (queryClient: QueryClient) =>
	queryClient.getQueryCache().find({ queryKey: ["projects", "list"] });

let opened: BroadcastChannel[] = [];
afterEach(() => {
	for (const channel of opened) channel.close();
	opened = [];
});

describe("the tabs of one browser", () => {
	test("a Space switch in one tab loads every query of the other tabs again", async () => {
		const [here, there] = twoTabs();
		opened = [here.channel, there.channel];
		const stop = there.tabs.follow(there.queryClient);

		await here.tabs.changed(here.queryClient);
		expect(projectsOf(here.queryClient)?.state.isInvalidated).toBe(true);
		// The other tab hears it on its own channel, a moment later.
		for (
			let i = 0;
			i < 50 && !projectsOf(there.queryClient)?.state.isInvalidated;
			i++
		) {
			await Bun.sleep(10);
		}
		expect(projectsOf(there.queryClient)?.state.isInvalidated).toBe(true);
		stop();
	});

	test("a tab that stopped following keeps its cache", async () => {
		const [here, there] = twoTabs();
		opened = [here.channel, there.channel];
		there.tabs.follow(there.queryClient)();

		await here.tabs.changed(here.queryClient);
		await Bun.sleep(50);
		expect(projectsOf(there.queryClient)?.state.isInvalidated).toBe(false);
	});

	test("without a channel, the tab still loads its own queries again", async () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(["projects", "list"], []);
		const tabs = createSpaceTabs(() => null);
		expect(tabs.follow(queryClient)).toBeFunction();
		await tabs.changed(queryClient);
		expect(projectsOf(queryClient)?.state.isInvalidated).toBe(true);
	});
});

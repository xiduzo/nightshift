import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { createGateQueries } from "../gates";
import type { ShownNotifications } from "./shown";
import { type HostApi, useLiveCache } from "./use-live-cache";

export type FollowHostHookOptions = {
	/** How this screen shows a notice and takes notifications away. Keep it the same object between renders. */
	shown: ShownNotifications;
	/** Follow now. The phone passes whether the app is in front. Default true. */
	enabled?: boolean;
	/** The phone app: Night Shift counts it as closed once it stops following. */
	phone?: boolean;
};

/**
 * Follows the Host while `enabled`: the live cache reads again what each
 * item of the notifications stream changes (the inbox, the runs, the
 * dashboard, the schedules), shows a notice for an item that alerts, and
 * takes away notifications of Gates that no longer wait. It keeps the open
 * Gates read, also by a poll while the stream is down. Mount it once per app, behind
 * the sign-in.
 */
export function useFollowHost(
	host: HostApi,
	{ shown, enabled = true, phone = false }: FollowHostHookOptions,
): void {
	const { client, orpc } = host;
	const live = useLiveCache(orpc);
	useQuery(createGateQueries(orpc).open());

	useEffect(() => {
		if (!enabled) return;
		const controller = new AbortController();
		void live.followHost({ client, shown, phone, signal: controller.signal });
		return () => controller.abort();
	}, [enabled, phone, client, shown, live]);
}

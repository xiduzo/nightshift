import { Redirect } from "expo-router";
import { useEffect } from "react";

import { LockScreenRuns, updateGlance, useHomeWidget } from "@/features/glance";
import { useHost } from "@/features/host";
import { useLiveInbox, useWaitingCount } from "@/features/inbox";
import { usePhonePush } from "@/features/push";
import { useRememberedSpace } from "@/features/spaces";
import { TabBar } from "./tab-bar";

/**
 * The four tabs: Home, Inbox, Runs and Projects. Without a Host, or
 * signed out, the person goes to the connect screen first. While signed
 * in, the inbox stays live, and the home screen widget and the runs
 * followed on the lock screen stay up to date.
 */
export function AppTabs() {
	const { state } = useHost();
	useEffect(() => {
		// A phone that is not signed in shows no Gates or runs on its widget.
		if (state.status === "signed-out") updateGlance(null);
	}, [state.status]);
	if (state.status === "loading") return null;
	if (state.status === "signed-out") return <Redirect href="/connect" />;
	return <SignedInTabs />;
}

function SignedInTabs() {
	useRememberedSpace();
	useLiveInbox();
	usePhonePush();
	useHomeWidget();
	const waiting = useWaitingCount();

	return (
		<>
			<LockScreenRuns />
			<TabBar waiting={waiting} />
		</>
	);
}

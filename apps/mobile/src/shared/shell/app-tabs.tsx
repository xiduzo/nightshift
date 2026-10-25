import { useFollowHost } from "@nightshift/client";
import { Redirect } from "expo-router";
import { useEffect } from "react";

import { LockScreenRuns, updateGlance, useHomeWidget } from "@/features/glance";
import { useHost, useSignedIn } from "@/features/host";
import { useWaitingCount } from "@/features/inbox";
import { phoneNotifications, usePhonePush } from "@/features/push";
import { useRememberedSpace } from "@/features/spaces";
import { useInFront } from "@/shared/in-front";
import { TabBar } from "./tab-bar";

/**
 * The four tabs: Home, Inbox, Runs and Projects. Without a Host, or
 * signed out, the person goes to the connect screen first. While signed
 * in and in front, the app follows the Host: the live cache reads again
 * what changed, and a new Gate shows as a banner in the app. The home
 * screen widget and the runs followed on the lock screen stay up to date.
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
	const { host } = useSignedIn();
	const inFront = useInFront();
	useRememberedSpace();
	useFollowHost(host, {
		shown: phoneNotifications,
		enabled: inFront,
		phone: true,
	});
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

import { Redirect } from "expo-router";
import type { ReactNode } from "react";

import { useHost } from "./host-provider";

/**
 * A screen behind the sign-in, outside the tabs: nothing while the session
 * loads, `signedOut` (the connect screen) once signed out. Its children may
 * use `useSignedIn`, also when the session ends while the screen is open.
 */
export function SignedInOnly({
	children,
	signedOut = <Redirect href="/connect" />,
}: {
	children: ReactNode;
	/** What shows signed out. A header item passes null: its screen redirects. */
	signedOut?: ReactNode;
}) {
	const { state } = useHost();
	if (state.status === "loading") return null;
	if (state.status === "signed-out") return signedOut;
	return children;
}

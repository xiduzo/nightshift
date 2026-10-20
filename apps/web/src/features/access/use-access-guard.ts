import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { accessRedirect } from "./access";
import { accountQueries } from "./queries";

/**
 * Sends a browser that may not see the app yet to sign in, or to the
 * two-factor setup the Host requires, and back to this page after. Says
 * whether the app may show: not while the account is loading or a
 * redirect is due, so its calls do not fail one by one. When the account
 * does not load, the app shows and tells the person it cannot reach Night
 * Shift.
 */
export function useAccessGuard(pathname: string, href: string): boolean {
	const navigate = useNavigate();
	const status = useQuery({
		...accountQueries.status(),
		meta: { quietErrors: true },
	});
	const target = status.data
		? accessRedirect(status.data, { pathname, href })
		: null;
	const to = target?.to;
	const redirect = target?.redirect;
	useEffect(() => {
		if (!to) return;
		void navigate({ to, search: { redirect }, replace: true });
	}, [to, redirect, navigate]);
	if (status.data) return target === null;
	// Not reached on the first try: show the app while the retries run.
	return status.failureCount > 0;
}

import { versionMessage } from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { accountQueries } from "./queries";

/** Night Shift was updated under this page: says so, and reloads the page when the person asks. */
export function VersionNotice() {
	const status = useQuery({
		...accountQueries.status(),
		meta: { quietErrors: true },
	});
	const message = status.data
		? versionMessage("page", status.data.version)
		: null;
	useEffect(() => {
		if (!message) return;
		toast.warning(message, {
			id: "version",
			duration: Number.POSITIVE_INFINITY,
			action: { label: "Reload page", onClick: () => location.reload() },
		});
	}, [message]);
	return null;
}

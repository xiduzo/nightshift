import { versionMessage } from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Alert } from "react-native";
import type { Host } from "./host";
import { useHost } from "./host-provider";

/** The Host this phone is signed in to has another version: says so, once per start. */
export function VersionNotice() {
	const { state } = useHost();
	return state.status === "signed-in" ? <Notice host={state.host} /> : null;
}

function Notice({ host }: { host: Host }) {
	const status = useQuery({
		...host.orpc.account.status.queryOptions(),
		meta: { quietErrors: true },
	});
	const message = status.data
		? versionMessage("phone", status.data.version)
		: null;
	useEffect(() => {
		if (message) Alert.alert("Update needed", message);
	}, [message]);
	return null;
}

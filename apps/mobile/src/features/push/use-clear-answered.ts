import { createGateQueries, gateKey } from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { useHostQueries } from "@/features/host";
import { dismissClosed } from "./shown";

/**
 * Takes away the Gate notifications whose Gate no longer waits, each time
 * the phone reads the open Gates. iOS may drop the withdraw push of an
 * answered Gate: this clears what it left.
 */
export function useClearAnswered(): void {
	const queries = useHostQueries(createGateQueries);
	const open = useQuery(queries.open());
	const { data, dataUpdatedAt } = open;

	useEffect(() => {
		if (!data) return;
		const keys = new Set(data.map(gateKey));
		void dismissClosed(keys, dataUpdatedAt).catch(() => undefined);
	}, [data, dataUpdatedAt]);
}

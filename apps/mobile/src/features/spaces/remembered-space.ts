import { createSpaceQueries } from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useHostQueries, useSignedIn } from "@/features/host";
import { loadSpaceChoice } from "./space-choice";
import { useSwitchSpace } from "./use-switch-space";

/**
 * Works in the Space the person last chose on this phone. A new session
 * starts in the personal Space; this switches back once, after the Spaces
 * load. A Space the person left is skipped.
 */
export function useRememberedSpace(): void {
	const { host } = useSignedIn();
	const spaceQueries = useHostQueries(createSpaceQueries);
	const spaces = useQuery(spaceQueries.list());
	const switchSpace = useSwitchSpace();
	const checked = useRef(false);

	useEffect(() => {
		const list = spaces.data;
		if (!list || checked.current) return;
		checked.current = true;
		void loadSpaceChoice(host.address).then((saved) => {
			if (
				saved &&
				saved !== list.active &&
				list.spaces.some((space) => space.id === saved)
			) {
				switchSpace.mutate({ spaceId: saved });
			}
		});
	}, [spaces.data, host.address, switchSpace]);
}

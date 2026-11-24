import { useQuery } from "@tanstack/react-query";
import { isSpaceAdmin, spaceQueries } from "@/features/spaces";

/** The role of the person in the active Space. Undefined while it loads. */
function useActiveRole() {
	const spaces = useQuery(spaceQueries.list());
	return spaces.data?.spaces.find((space) => space.id === spaces.data?.active)
		?.role;
}

/**
 * Whether the person may change the projects of the active Space, with
 * their flows and schedules: every role but Viewer. No while the role loads.
 */
export function useMayChange(): boolean {
	const role = useActiveRole();
	return role !== undefined && role !== "viewer";
}

/**
 * Whether the person may move a project out of the active Space or remove
 * it: an owner or an admin. No while the role loads.
 */
export function useMayMoveOrRemove(): boolean {
	return isSpaceAdmin(useActiveRole());
}

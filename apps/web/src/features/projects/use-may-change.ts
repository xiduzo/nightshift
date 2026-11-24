import { useQuery } from "@tanstack/react-query";
import { spaceQueries } from "@/features/spaces";

/**
 * Whether the person may change the projects of the active Space, with
 * their flows and schedules: every role but Viewer. No while the role loads.
 */
export function useMayChange(): boolean {
	const spaces = useQuery(spaceQueries.list());
	const role = spaces.data?.spaces.find(
		(space) => space.id === spaces.data?.active,
	)?.role;
	return role !== undefined && role !== "viewer";
}

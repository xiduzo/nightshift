import type { Query, QueryClient } from "@tanstack/react-query";

/**
 * Whether a query reads the Host for the active Space: a procedure of the
 * Host (its key starts with the procedure's path), but not the open Gates,
 * which span every Space the person is in.
 */
function ofActiveSpace({ queryKey }: Query): boolean {
	const [path] = queryKey;
	return Array.isArray(path) && path[0] !== "gates";
}

/**
 * The active Space changed: forget what the cache holds of the Space
 * before, and read again what the screens show. The Space is not in the
 * query keys, so a query kept from before would show the old Space a
 * moment. The app's own queries (its session) stay.
 */
export function spaceChanged(queryClient: QueryClient): Promise<void> {
	return queryClient.resetQueries({ predicate: ofActiveSpace });
}

import type { UseMutationOptions } from "@tanstack/react-query";

export type UsefulInput = { runId: string; useful: boolean };

type UsefulOptions = UseMutationOptions<unknown, Error, UsefulInput>;

/**
 * The options of `runs.useful`. The runs query factory wins once it has
 * `useful`. Until then this calls `runs.useful.mutationOptions`, the same
 * way as the other run mutations.
 */
export function usefulOptions(
	orpc: { runs: object },
	queries: object,
	options?: object,
): UsefulOptions {
	const factory = queries as {
		useful?: (options?: object) => UsefulOptions;
	};
	if (typeof factory.useful === "function") return factory.useful(options);
	const runs = orpc.runs as {
		useful?: {
			mutationOptions?: (options?: object) => UsefulOptions;
		};
	};
	const call = runs.useful?.mutationOptions;
	if (typeof call === "function") return call(options);
	return {
		mutationFn: async () => {
			throw new Error("Night Shift did not save that. Try again.");
		},
	};
}

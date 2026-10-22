import type { HostClient } from "../contract";

/** Some procedures of a Host, each with the type `HostClient` gives it. */
export type PartialHostClient = {
	[Group in keyof HostClient]?: Partial<HostClient[Group]>;
};

/**
 * A Host for a test that needs a few of its procedures: the ones given
 * answer, every other one rejects. For the full Host in memory, use
 * `inMemoryHost`.
 */
export function partialHostClient(procedures: PartialHostClient): HostClient {
	const group = (name: string) =>
		new Proxy(
			{},
			{
				get(_, procedure) {
					const given = (
						procedures as Record<string, Record<string | symbol, unknown>>
					)[name]?.[procedure];
					return (
						given ??
						(() =>
							Promise.reject(
								new Error(
									`This test Host does not serve ${name}.${String(procedure)}.`,
								),
							))
					);
				},
			},
		);
	// No `then`: a promise that resolves to this client does not take it for one.
	return new Proxy({} as HostClient, {
		get: (_, name) => (name === "then" ? undefined : group(String(name))),
	});
}

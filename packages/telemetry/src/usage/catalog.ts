import { usageEventSchema } from "@nightshift/semconv";

/** The events and the fields each one can send, from the generated registry. */
export function usageCatalog(): {
	events: { name: string; attributes: string[] }[];
} {
	return {
		events: Object.entries(usageEventSchema)
			.map(([name, schema]) => ({
				name,
				attributes: Object.keys(schema.shape)
					.filter((key) => key !== "name")
					.sort(),
			}))
			.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
	};
}

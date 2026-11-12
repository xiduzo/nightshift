// "My kits" in the add-node dialog: the flows of the Space that another
// flow already runs, this project's first. A person made them to reuse.

import { callersOf, type Flow, type ProjectFlowMap } from "@nightshift/flows";
import { type CatalogEntry, firstSentence, SUBFLOW_ICON } from "./catalog";

/** The flows of another project of the Space, by name. */
export type OtherProject = {
	projectId: string;
	project: string;
	flows: ProjectFlowMap;
};

/** The valid flows of `flows` that another of them runs, by name. */
function reused(flows: ProjectFlowMap): [string, Flow][] {
	return Object.entries(flows)
		.filter(
			(entry): entry is [string, Flow] =>
				entry[1] !== null && callersOf(entry[0], flows).length > 0,
		)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function entry(
	name: string,
	flow: Flow,
	from?: { projectId: string; project: string },
): CatalogEntry {
	return {
		key: from ? `flow:${from.projectId}/${name}` : `flow:${name}`,
		family: "compose",
		takes: "nothing",
		label: name,
		blurb: firstSentence(flow.description),
		icon: SUBFLOW_ICON,
		keywords: [
			"my kits",
			"kit",
			"subflow",
			...name.split("-"),
			...(from ? [from.project] : []),
		],
		...(from ? { badge: from.project } : {}),
		add: { kind: "kit", flow: name, ...(from ? { from } : {}) },
	};
}

/**
 * The entries of "My kits". First this project's flows that another flow
 * runs, the open draft included as a caller, but not the open flow
 * itself. Then the same for each other project, which a pick copies here.
 * A flow this project has already, the same in every part, is left out
 * there. A flow that is not valid is no kit. Until this project's flows
 * are read, there are none.
 */
export function myKitEntries({
	flowName,
	draft,
	flows,
	others,
}: {
	/** The flow open in the editor. */
	flowName: string;
	draft: Flow;
	/** This project's other flows. Undefined while they load. */
	flows: ProjectFlowMap | undefined;
	others: readonly OtherProject[];
}): CatalogEntry[] {
	if (!flows) return [];
	const here: ProjectFlowMap = { ...flows, [flowName]: draft };
	const own = reused(here)
		.filter(([name]) => name !== flowName)
		.map(([name, flow]) => entry(name, flow));
	const copies = [...others]
		.sort((a, b) => a.project.localeCompare(b.project))
		.flatMap(({ projectId, project, flows: theirs }) =>
			reused(theirs)
				.filter(
					([name, flow]) => JSON.stringify(here[name]) !== JSON.stringify(flow),
				)
				.map(([name, flow]) => entry(name, flow, { projectId, project })),
		);
	return [...own, ...copies];
}

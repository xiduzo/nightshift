import {
	gateParts,
	gateRun,
	inboxOrder,
	type OpenGate,
	waitedText,
	waitingForYou,
} from "@nightshift/client";

/**
 * What the Inbox tab shows, without React Native: which Gates (a Space or
 * a project), in which order, grouped by project, and the words of each
 * row. The screen draws it.
 */

/** Where the inbox takes its Gates from: every Space, one Space, or one project. */
export type InboxPlace =
	| { kind: "all" }
	| { kind: "space"; spaceId: string }
	| { kind: "project"; projectId: string };

/** Oldest first: the Gate that waited longest on top. */
export type InboxSort = "oldest" | "newest";

export type InboxView = { place: InboxPlace; sort: InboxSort };

export const ALL_GATES: InboxView = { place: { kind: "all" }, sort: "oldest" };

type Placed = Pick<
	OpenGate,
	| "spaceId"
	| "spaceName"
	| "projectId"
	| "projectName"
	| "openedAt"
	| "runId"
	| "stepId"
>;

/** Whether a Gate is in a place. */
export function inPlace(gate: Placed, place: InboxPlace): boolean {
	switch (place.kind) {
		case "all":
			return true;
		case "space":
			return gate.spaceId === place.spaceId;
		case "project":
			return gate.projectId === place.projectId;
	}
}

export function samePlace(a: InboxPlace, b: InboxPlace): boolean {
	if (a.kind === "all" || b.kind === "all") return a.kind === b.kind;
	if (a.kind === "space" && b.kind === "space") return a.spaceId === b.spaceId;
	if (a.kind === "project" && b.kind === "project") {
		return a.projectId === b.projectId;
	}
	return false;
}

/** How many Spaces the Gates come from. */
export function spaceCount(
	gates: readonly Pick<OpenGate, "spaceId">[],
): number {
	return new Set(gates.map((gate) => gate.spaceId)).size;
}

/** The Gates of one project, under one head. */
export type InboxGroup<G> = {
	key: string;
	/** "website", or "Acme · website" when you are in more than one Space. */
	title: string;
	gates: G[];
};

/**
 * The Gates of a view, grouped by project. The groups and the Gates in
 * them keep the sort: oldest first puts the project whose Gate waited
 * longest on top. `manySpaces` puts the Space before each project.
 */
export function inboxGroups<G extends Placed>(
	gates: readonly G[],
	view: InboxView,
	manySpaces: boolean,
): InboxGroup<G>[] {
	const ordered = inboxOrder(gates.filter((gate) => inPlace(gate, view.place)));
	if (view.sort === "newest") ordered.reverse();
	const groups = new Map<string, InboxGroup<G>>();
	for (const gate of ordered) {
		const key = `${gate.spaceId}:${gate.projectId}`;
		const group = groups.get(key);
		if (group) {
			group.gates.push(gate);
			continue;
		}
		groups.set(key, {
			key,
			title: manySpaces
				? `${gate.spaceName} · ${gate.projectName}`
				: gate.projectName,
			gates: [gate],
		});
	}
	return [...groups.values()];
}

/** One choice of the place picker. */
export type PlaceOption = {
	place: InboxPlace;
	label: string;
	/** How many open Gates it holds. */
	count: number;
	/** A project under its Space: the picker indents it. */
	nested: boolean;
};

/**
 * The places the inbox can show: every Gate, then each Space (when you
 * are in more than one) with its projects under it, else each project.
 * By name, so the list keeps its order while Gates come and go.
 */
export function placeOptions(
	gates: readonly Placed[],
	manySpaces: boolean,
): PlaceOption[] {
	const options: PlaceOption[] = [
		{
			place: { kind: "all" },
			label: "All Gates",
			count: gates.length,
			nested: false,
		},
	];
	const spaces = new Map<string, { name: string; gates: Placed[] }>();
	for (const gate of gates) {
		const space = spaces.get(gate.spaceId);
		if (space) space.gates.push(gate);
		else spaces.set(gate.spaceId, { name: gate.spaceName, gates: [gate] });
	}
	const byName = <T extends { name: string }>(a: T, b: T) =>
		a.name.localeCompare(b.name);
	for (const [spaceId, space] of [...spaces].sort(([, a], [, b]) =>
		byName(a, b),
	)) {
		if (manySpaces) {
			options.push({
				place: { kind: "space", spaceId },
				label: space.name,
				count: space.gates.length,
				nested: false,
			});
		}
		const projects = new Map<string, { name: string; count: number }>();
		for (const gate of space.gates) {
			const project = projects.get(gate.projectId);
			if (project) project.count += 1;
			else projects.set(gate.projectId, { name: gate.projectName, count: 1 });
		}
		for (const [projectId, project] of [...projects].sort(([, a], [, b]) =>
			byName(a, b),
		)) {
			options.push({
				place: { kind: "project", projectId },
				label: project.name,
				count: project.count,
				nested: manySpaces,
			});
		}
	}
	return options;
}

/** The name of a place on its chip: "website", "Acme", or "Project" for every Gate. */
export function placeLabel(
	place: InboxPlace,
	gates: readonly Placed[],
): string {
	switch (place.kind) {
		case "all":
			return "Project";
		case "space":
			return (
				gates.find((gate) => gate.spaceId === place.spaceId)?.spaceName ??
				"Space"
			);
		case "project":
			return (
				gates.find((gate) => gate.projectId === place.projectId)?.projectName ??
				"Project"
			);
	}
}

/** The line under the title: "3 Gates need you · 2 Spaces". */
export function inboxSummary(
	gates: readonly Pick<OpenGate, "canAnswer" | "spaceId">[],
): string {
	const waiting = waitingForYou(gates);
	const need =
		waiting === 0
			? "Nothing needs you"
			: waiting === 1
				? "1 Gate needs you"
				: `${waiting} Gates need you`;
	const spaces = spaceCount(gates);
	return spaces > 1 ? `${need} · ${spaces} Spaces` : need;
}

/** "1 choice", "3 choices". */
export function choicesText(count: number): string {
	return count === 1 ? "1 choice" : `${count} choices`;
}

/** The words of one Gate's row. Its status word is `gateLook` of `shared/tone`. */
export type GateRowText = {
	/** "website · Feature factory" */
	overline: string;
	/** The question itself. */
	title: string;
	/** "2 choices", then the node id in mono. */
	choices: string;
	nodeId: string;
	/** "12 min" */
	waited: string;
	/** The question links a pull request: the row shows its icon. */
	pullRequest: boolean;
};

export function gateRowText(
	gate: Pick<
		OpenGate,
		| "question"
		| "projectName"
		| "flowName"
		| "runTitle"
		| "choices"
		| "nodeId"
		| "openedAt"
	>,
	now: number,
): GateRowText {
	const { headline, links } = gateParts(gate.question);
	const { flow } = gateRun(gate);
	return {
		overline: `${gate.projectName} · ${flow}`,
		title: headline,
		choices: choicesText(gate.choices.length),
		nodeId: gate.nodeId,
		waited: waitedText(now - gate.openedAt),
		pullRequest: links.some((link) => link.kind === "pull"),
	};
}

/**
 * The Gate to answer after this one: the next one you may answer, in
 * inbox order (oldest first). Null when nothing else waits for you.
 */
export function nextGate<
	G extends Pick<
		OpenGate,
		"runId" | "stepId" | "openedAt" | "canAnswer" | "answerPending"
	>,
>(gates: readonly G[], current: Pick<OpenGate, "runId" | "stepId">): G | null {
	return (
		inboxOrder(gates).find(
			(gate) =>
				gate.canAnswer &&
				!gate.answerPending &&
				(gate.runId !== current.runId || gate.stepId !== current.stepId),
		) ?? null
	);
}

import {
	canonicalFlowJson,
	type Flow,
	type FlowIssue,
	type FlowSources,
	readFlow,
	suffixedName,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";

/** A flow as a file to save and import elsewhere. */
export type FlowExport = { fileName: string; json: string };

/** A flow that an import or a copy saved: its name there, and its problems. */
export type SavedFlow = { name: string; issues: FlowIssue[] };

/** What an import of the starters did: the names it saved, and the names the project had already. */
export type StarterImport = { imported: string[]; skipped: string[] };

/** The flow as a JSON file, in the form Night Shift saves it. */
export function flowFile(name: string, flow: Flow): FlowExport {
	return { fileName: `${name}.json`, json: canonicalFlowJson(flow) };
}

/** The names of the flows a project has. */
export function namesOf(sources: FlowSources): Set<string> {
	return new Set(Object.keys(sources));
}

/** The refusal of a flow that does not read as a flow. */
export function notValidFlow(name: string): Refusal {
	return new Refusal(
		"invalid",
		`The flow "${name}" is not valid. Fix it in the editor first.`,
	);
}

/** The refusal of a copy to a name the project has already, with a free one. */
export function nameTaken(name: string, taken: ReadonlySet<string>): Refusal {
	return new Refusal(
		"conflict",
		`That project has a flow named "${name}" already. Copy it as "${suffixedName(name, taken)}" instead.`,
	);
}

/** The flow a JSON file holds, or a refusal that says what is wrong. */
export function importedFlow(json: string): Flow {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new Refusal(
			"invalid",
			"This file is not a flow. Choose a flow file that Night Shift exported.",
		);
	}
	return flowOfFile(parsed);
}

/** A flow file's contents as a flow, or a refusal that says what is wrong. */
export function flowOfFile(contents: unknown): Flow {
	const read = readFlow(contents);
	if (read.flow !== null) return read.flow;
	switch (read.why) {
		case "older":
			throw new Refusal(
				"invalid",
				"An older version of Night Shift made this file. Night Shift cannot import it.",
			);
		case "newer":
			throw new Refusal(
				"invalid",
				"A newer version of Night Shift made this flow. Update Night Shift to import it.",
			);
		case "invalid": {
			const issue = read.issues[0];
			const where = issue?.path ? ` at ${issue.path}` : "";
			throw new Refusal(
				"invalid",
				`This file is not a valid flow${where}: ${issue?.message ?? "check its format"}. Choose a flow file that Night Shift exported.`,
			);
		}
	}
}

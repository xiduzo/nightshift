import {
	canonicalFlowJson,
	FLOW_VERSION,
	type Flow,
	type FlowIssue,
	type FlowMigration,
	type FlowSources,
	flowSchema,
	migrateFlow,
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

/** The flow a JSON file holds, brought to the current format, or a refusal that says what is wrong. */
export function importedFlow(json: string, migration?: FlowMigration): Flow {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new Refusal(
			"invalid",
			"This file is not a flow. Choose a flow file that Night Shift exported.",
		);
	}
	return migratedFlow(parsed, migration);
}

/** A flow file's contents, brought to the current format, or a refusal that says what is wrong. */
export function migratedFlow(parsed: unknown, migration?: FlowMigration): Flow {
	const migrated = migrateFlow(parsed, migration);
	const version =
		migrated !== null && typeof migrated === "object" && "version" in migrated
			? migrated.version
			: undefined;
	if (typeof version === "number" && version > FLOW_VERSION) {
		throw new Refusal(
			"invalid",
			"A newer version of Night Shift made this flow. Update Night Shift to import it.",
		);
	}
	const flow = flowSchema.safeParse(migrated);
	if (!flow.success) {
		const issue = flow.error.issues[0];
		const where =
			issue && issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
		throw new Refusal(
			"invalid",
			`This file is not a valid flow${where}: ${issue?.message ?? "check its format"}. Choose a flow file that Night Shift exported.`,
		);
	}
	return flow.data;
}

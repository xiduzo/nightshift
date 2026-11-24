import { githubSubIssuesCommand } from "./github";
import { isRecord } from "./record";
import { migrateCallNodes, migrateDecisionNodes, migrateV1 } from "./v1-to-v4";
import {
	type FlowMigration,
	migrateV5,
	migrateV6,
	migrateV7,
	migrateV8,
} from "./v5-to-v9";

export function migrateFlow(json: unknown, migration?: FlowMigration): unknown {
	let current = isRecord(json) && json.version === 1 ? migrateV1(json) : json;
	if (isRecord(current) && current.version === 2) {
		current = migrateDecisionNodes(current);
	}
	if (isRecord(current) && current.version === 3) {
		current = migrateCallNodes(current);
	}
	if (isRecord(current) && current.version === 4) {
		current = { ...current, version: 5 };
	}
	if (isRecord(current) && current.version === 5) {
		current = migrateV5(current);
	}
	if (isRecord(current) && current.version === 6) {
		current = migrateV6(current, migration);
	}
	if (isRecord(current) && current.version === 7) {
		current = migrateV7(current, migration);
	}
	if (isRecord(current) && current.version === 8) {
		current = migrateV8(current);
	}
	if (!isRecord(current) || !Array.isArray(current.nodes)) return current;
	let changed = false;
	const nodes = current.nodes.map((node) => {
		const migrated = migrateListSource(migrateDecider(migrateToolSets(node)));
		if (migrated !== node) changed = true;
		return migrated;
	});
	return changed ? { ...current, nodes } : current;
}

function migrateListSource(json: unknown): unknown {
	if (!isRecord(json) || json.type !== "call") return json;
	const each = json.each;
	if (!isRecord(each)) return json;
	const source = each.source;
	if (!isRecord(source) || source.kind !== "github") return json;
	if (typeof source.parent !== "string") return json;
	const labels = (value: unknown) =>
		Array.isArray(value)
			? value.filter((label): label is string => typeof label === "string")
			: [];
	return {
		...json,
		each: {
			...each,
			source: {
				kind: "command",
				command: githubSubIssuesCommand({
					parent: source.parent,
					...(typeof source.requireLabel === "string"
						? { requireLabel: source.requireLabel }
						: {}),
					doneLabels: labels(source.doneLabels),
					skipLabels: labels(source.skipLabels),
				}),
			},
		},
	};
}

function migrateDecider(json: unknown): unknown {
	if (!isRecord(json) || json.decider !== "claude-code") return json;
	const { decider: _decider, model: _model, ...rest } = json;
	return rest;
}

function migrateToolSets(json: unknown): unknown {
	if (!isRecord(json) || !("tools" in json)) return json;
	const { tools, ...rest } = json;
	const github = Array.isArray(tools) && tools.includes("github");
	if (!github || rest.type === "decision") return rest;
	const clis = Array.isArray(rest.clis) ? rest.clis : [];
	return { ...rest, clis: clis.includes("gh") ? clis : [...clis, "gh"] };
}

import type { FlowOutputDef } from "../../flow";
import type { VariableWrite } from "../../nodes";
import type { SubflowChange, SubflowReader } from "./plan";
import { CALL_FIELDS, claim, type Planner } from "./planner";

/**
 * What the new flow gives back: the fields that templates outside read,
 * and the variables written inside. It adds both to `changes`.
 */
export function subflowOutputs(
	plan: Planner,
	used: { usedVars: readonly string[]; writers: ReadonlyMap<string, string[]> },
	callId: string,
	changes: SubflowChange[],
) {
	const { members } = plan;
	const { usedVars, writers } = used;
	// Outputs: fields of nodes inside that templates outside read.
	const outputs: FlowOutputDef[] = [];
	const outTaken = new Set<string>(CALL_FIELDS);
	const outputOf = new Map<
		string,
		Extract<SubflowChange, { code: "output-added" }>
	>();
	for (const read of plan.reads) {
		if (plan.inside(read.reader) || read.rule) continue;
		const [field] = read.path;
		if (!members.has(read.name) || field === undefined) continue;
		const key = `${read.name}.${field}`;
		const known = outputOf.get(key);
		if (known) {
			if (!known.readBy.some((r) => sameReader(r, read.reader)))
				known.readBy.push(read.reader);
			continue;
		}
		const output = claim(outTaken, `${read.name}_${field}`, 40, "_");
		outputs.push({ name: output, value: `{{${read.name}.${field}}}` });
		outputOf.set(key, {
			kind: "info",
			code: "output-added",
			output,
			node: read.name,
			field,
			readBy: [read.reader],
		});
	}
	changes.push(...outputOf.values());

	// Variables written inside go back to the caller through the Call's writes.
	const writeBack: VariableWrite[] = [];
	for (const variable of usedVars) {
		const by = writers.get(variable);
		if (!by) continue;
		const output = claim(outTaken, variable, 40, "_");
		outputs.push({ name: output, value: `{{vars.${variable}}}` });
		writeBack.push({ variable, value: `{{${callId}.${output}}}` });
		changes.push({
			kind: "info",
			code: "variable-written-back",
			variable,
			output,
			writtenBy: by,
		});
	}
	return { outputs, outputOf, writeBack };
}

function sameReader(a: SubflowReader, b: SubflowReader): boolean {
	return "node" in a
		? "node" in b && a.node === b.node
		: "output" in b && a.output === b.output;
}

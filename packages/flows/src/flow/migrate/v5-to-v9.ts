import { gitFilesCommand } from "../../recipes";
import { isRecord } from "./record";

/**
 * The steps from version 5 to version 9 of the flow format: the node
 * review (5 → 6), profiles and Devices by id (6 → 7, 7 → 8) and the
 * shape of a Command's output (8 → 9). `migrateFlow` says what each one
 * changes.
 */

/**
 * What the steps to versions 7 and 8 need to find the profile and the
 * Device a node named by their names. A flow of format 6 named a profile
 * by its name, and the run found it on the node's Device (`device`, a
 * Device name), else on the Device that ran the step. Format 7 names the
 * Device and the profile's id. Format 8 names the node's own Device by id.
 */
export type FlowMigration = {
	/**
	 * The Device a node without `device` takes its profile from: the Device
	 * that saved the flow, or the one that imports it.
	 */
	deviceId: string;
	/**
	 * A Device's id by its name, or null when no Device of the Space has
	 * that name, or two do. Never a guess between two Devices.
	 */
	deviceIdByName(name: string): string | null;
	/**
	 * The id of a Device's profile by its name, or null when that Device
	 * has no profile of that name, or this computer cannot tell.
	 */
	profileIdByName(deviceId: string, name: string): string | null;
};

/**
 * Version 6 → 7. A node's profile name becomes the pair `{ device,
 * profile }`: the Device from the node's `device` (which goes, as the
 * profile's Device runs the step), else `migration.deviceId`, and the
 * profile's id on that Device (`profileIdByName`, never the name: a
 * profile renamed after ids came keeps its old name as its id). Without a
 * migration, or when the Device or the profile is not known, the node
 * keeps its name and its `device`: the flow check asks to pick the
 * profile again. Night Shift never guesses another Device's profile.
 */
export function migrateV6(
	json: Record<string, unknown>,
	migration?: FlowMigration,
): Record<string, unknown> {
	const nodes = Array.isArray(json.nodes)
		? json.nodes.map((node) => migrateProfileName(node, migration))
		: json.nodes;
	return {
		...json,
		version: 7,
		...(nodes === undefined ? {} : { nodes }),
	};
}

function migrateProfileName(
	json: unknown,
	migration: FlowMigration | undefined,
): unknown {
	if (!isRecord(json) || typeof json.profile !== "string") return json;
	if (!migration) return json;
	const deviceName = typeof json.device === "string" ? json.device : null;
	const deviceId =
		deviceName === null
			? migration.deviceId
			: migration.deviceIdByName(deviceName);
	if (deviceId === null) return json;
	const profileId = migration.profileIdByName(deviceId, json.profile);
	if (profileId === null) return json;
	const { device: _device, ...rest } = json;
	return { ...rest, profile: { device: deviceId, profile: profileId } };
}

/**
 * Version 7 → 8. A node's `device` goes from a Device's name to its id
 * (`migration.deviceIdByName`). A name it cannot bring to one id, or any
 * name without a migration, becomes `{ name }`: the node does not run, and
 * the flow check asks to choose the device again. Night Shift never
 * guesses between two Devices of one name.
 */
export function migrateV7(
	json: Record<string, unknown>,
	migration?: FlowMigration,
): Record<string, unknown> {
	const nodes = Array.isArray(json.nodes)
		? json.nodes.map((node) => migrateDeviceName(node, migration))
		: json.nodes;
	return {
		...json,
		version: 8,
		...(nodes === undefined ? {} : { nodes }),
	};
}

/**
 * Version 8 → 9. A Command node's `output` said what the command prints:
 * `"text"` or `"json"`. It moves to `stdout`, so `output` can be the
 * node's output schema, as on an Agent or a Value node. A Command node
 * without `output` stays as it was: `stdout` defaults to `"text"`.
 */
export function migrateV8(
	json: Record<string, unknown>,
): Record<string, unknown> {
	const nodes = Array.isArray(json.nodes)
		? json.nodes.map(migrateCommandOutput)
		: json.nodes;
	return {
		...json,
		version: 9,
		...(nodes === undefined ? {} : { nodes }),
	};
}

function migrateCommandOutput(json: unknown): unknown {
	if (!isRecord(json) || json.type !== "command" || !("output" in json)) {
		return json;
	}
	const { output, ...rest } = json;
	return typeof output === "string" ? { ...rest, stdout: output } : rest;
}

/** A Device's name as format 8 names it: its id, else `{ name }` to choose again. */
export function deviceRefOfName(
	name: string,
	migration: Pick<FlowMigration, "deviceIdByName"> | undefined,
): string | { name: string } {
	const trimmed = name.trim();
	const id = migration?.deviceIdByName(trimmed) ?? null;
	return id ?? { name: trimmed };
}

function migrateDeviceName(
	json: unknown,
	migration: FlowMigration | undefined,
): unknown {
	if (!isRecord(json) || typeof json.device !== "string") return json;
	return { ...json, device: deviceRefOfName(json.device, migration) };
}

/**
 * Version 5 → 6. Steps of the node review land here, one per change.
 */
export function migrateV5(
	json: Record<string, unknown>,
): Record<string, unknown> {
	const nodes = Array.isArray(json.nodes)
		? json.nodes.map((node) =>
				migrateAgentNode(migrateFilesSource(dropUnreadDeciders(node))),
			)
		: json.nodes;
	return {
		...dropShadowedEdges(json),
		version: 6,
		...(nodes === undefined ? {} : { nodes }),
	};
}

/**
 * A Decision by a person or a rule, and a Value by a rule, lose `decider`
 * and `model`: the schema wrote a default decider into every one of them,
 * and only a model reads it. Returns the input unchanged otherwise.
 */
function dropUnreadDeciders(json: unknown): unknown {
	if (!isRecord(json)) return json;
	if (json.type !== "decision" && json.type !== "value") return json;
	if (json.by === "model") return json;
	if (!("decider" in json) && !("model" in json)) return json;
	const { decider: _decider, model: _model, ...rest } = json;
	return rest;
}

/**
 * A Call node with `each` whose source was `kind: "files"` reads the same
 * items from a `command` source: `gitFilesCommand` on the same glob.
 * Returns the input unchanged when it is any other node or source.
 */
function migrateFilesSource(json: unknown): unknown {
	if (!isRecord(json) || json.type !== "call") return json;
	const each = json.each;
	if (!isRecord(each)) return json;
	const source = each.source;
	if (!isRecord(source) || source.kind !== "files") return json;
	if (typeof source.glob !== "string") return json;
	return {
		...json,
		each: {
			...each,
			source: { kind: "command", command: gitFilesCommand(source.glob) },
		},
	};
}

/**
 * An Agent node loses `checker`: a Decision by a model after the Agent does
 * its job. It loses `mcpServers`: Connections give an Agent its MCP
 * servers, and keep their secrets off the flow file. `nodeClis` joins
 * `clis`: one list of the programs the agent may run, the node's CLI tools
 * first. Returns the input unchanged when it is any other node.
 */
function migrateAgentNode(json: unknown): unknown {
	if (!isRecord(json) || json.type !== "agent") return json;
	const {
		checker: _checker,
		mcpServers: _mcpServers,
		nodeClis,
		...rest
	} = json;
	const names = (value: unknown) =>
		Array.isArray(value)
			? value.filter((name): name is string => typeof name === "string")
			: [];
	const clis = [...new Set([...names(rest.clis), ...names(nodeClis)])];
	if (clis.length > 0) return { ...rest, clis };
	const { clis: _clis, ...without } = rest;
	return without;
}

/**
 * Drops each edge without a max that follows another edge without a max on
 * the same node and outcome. Version 5 took the first of them and never
 * the others; version 6 would take them all at once. The edges a version 5
 * run could take stay, in their order.
 */
export function dropShadowedEdges(
	json: Record<string, unknown>,
): Record<string, unknown> {
	if (!Array.isArray(json.edges)) return json;
	const open = new Set<string>();
	const edges = json.edges.filter((edge) => {
		if (!isRecord(edge) || edge.max !== undefined) return true;
		const key = `${String(edge.from)}\u0000${String(edge.outcome)}`;
		if (open.has(key)) return false;
		open.add(key);
		return true;
	});
	return edges.length === json.edges.length ? json : { ...json, edges };
}

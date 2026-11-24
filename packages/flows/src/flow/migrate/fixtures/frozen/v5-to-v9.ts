import { gitFilesCommand } from "./files";
import { isRecord } from "./record";

export type FlowMigration = {
	deviceId: string;
	deviceIdByName(name: string): string | null;
	profileIdByName(deviceId: string, name: string): string | null;
};

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

function deviceRefOfName(
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

function dropUnreadDeciders(json: unknown): unknown {
	if (!isRecord(json)) return json;
	if (json.type !== "decision" && json.type !== "value") return json;
	if (json.by === "model") return json;
	if (!("decider" in json) && !("model" in json)) return json;
	const { decider: _decider, model: _model, ...rest } = json;
	return rest;
}

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

function dropShadowedEdges(
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

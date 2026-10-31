import { join } from "node:path";
import {
	type ConnectionStore,
	type KeyStoreKind,
	type SettingsStore,
	valueStore,
} from "@nightshift/engine/device-config";

/**
 * The export's headers used to be kept in a value store of their own: the
 * keychain service `nightshift-telemetry`, else `<dataDir>/telemetry`, as
 * one JSON value. Now each header is part of the setting, and a value is
 * a secret. On start, this moves what the old store holds: each value
 * into a secret (`OTEL_HEADER_<NAME>`), the setting to reference it, and
 * the old value away. The export goes on with no step by the person.
 */

const OLD_SERVICE = "nightshift-telemetry";
const OLD_NAME = "otlp-headers";

/** The secret a header's value moves to: `X-Scope-OrgID` → `OTEL_HEADER_X_SCOPE_ORGID`. */
function headerSecretName(header: string): string {
	return `OTEL_HEADER_${header.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`.slice(
		0,
		128,
	);
}

/** Reads the old store's headers. Nothing, or a value that does not parse: none. */
function parseOld(raw: string | null): Record<string, string> {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (parsed === null || typeof parsed !== "object") return {};
		return Object.fromEntries(
			Object.entries(parsed).filter(
				(entry): entry is [string, string] =>
					typeof entry[1] === "string" && entry[1] !== "",
			),
		);
	} catch {
		return {};
	}
}

/** Moves the headers of the old store into the setting and the secrets. Returns the names it moved. */
export async function moveTelemetryHeaders(deps: {
	dataDir: string;
	keyStore: { prefer?: KeyStoreKind };
	settings: Pick<SettingsStore, "current" | "save">;
	secrets: Pick<ConnectionStore, "secret" | "secretSource" | "setSecret">;
}): Promise<string[]> {
	const old = await valueStore({
		service: OLD_SERVICE,
		dir: join(deps.dataDir, "telemetry"),
		...deps.keyStore,
	});
	const raw = await old.get(OLD_NAME);
	if (raw === null) return [];
	const headers = parseOld(raw);
	const moved = Object.keys(headers);
	if (moved.length > 0) {
		const next = { ...deps.settings.current().telemetryHeaders };
		for (const [header, value] of Object.entries(headers)) {
			const name = await freeName(
				deps.secrets,
				headerSecretName(header),
				value,
			);
			await deps.secrets.setSecret(name, value);
			next[header] = `\${${name}}`;
		}
		await deps.settings.save({ telemetryHeaders: next });
	}
	await old.delete(OLD_NAME);
	return moved;
}

/** `name`, or `name_2`, `name_3`… when a saved secret of that name holds another value. */
async function freeName(
	secrets: Pick<ConnectionStore, "secret" | "secretSource">,
	name: string,
	value: string,
): Promise<string> {
	for (let n = 1; ; n++) {
		const candidate = n === 1 ? name : `${name}_${n}`;
		if (secrets.secretSource(candidate) !== "keychain") return candidate;
		if ((await secrets.secret(candidate)) === value) return candidate;
	}
}

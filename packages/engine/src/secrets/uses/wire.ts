import type { Scopes } from "../scopes";
import { expandSecretReferences } from "./application/expand-secret-references";
import { listExportValues } from "./application/list-export-values";
import { listSecretValues } from "./application/list-secret-values";
import { noteSecretUse } from "./application/note-secret-use";
import { readSecret } from "./application/read-secret";
import { readSecretEnv } from "./application/read-secret-env";
import { readWebhookSecret } from "./application/read-webhook-secret";
import { resolveSecrets } from "./application/resolve-secrets";

/**
 * The wiring of the uses: Night Shift reads values for a step, a webhook,
 * an agent's env or a connection, and notes each use. It binds each use
 * case to the ports of the scopes. It builds no adapter of its own.
 */

/** The use cases of the uses, bound to their ports. */
export type Uses = {
	resolveSecrets: ReturnType<typeof resolveSecrets>;
	noteSecretUse: ReturnType<typeof noteSecretUse>;
	readSecret: ReturnType<typeof readSecret>;
	readWebhookSecret: ReturnType<typeof readWebhookSecret>;
	readSecretEnv: ReturnType<typeof readSecretEnv>;
	expandSecretReferences: ReturnType<typeof expandSecretReferences>;
	listSecretValues: ReturnType<typeof listSecretValues>;
	listExportValues: ReturnType<typeof listExportValues>;
};

export function wireUses(scopes: Scopes): Uses {
	const resolve = resolveSecrets(scopes);
	const noteUse = noteSecretUse(scopes);
	const reads = { ...scopes, resolve, noteUse };
	const secretValues = listSecretValues(reads);
	return {
		resolveSecrets: resolve,
		noteSecretUse: noteUse,
		readSecret: readSecret(reads),
		readWebhookSecret: readWebhookSecret(reads),
		readSecretEnv: readSecretEnv(reads),
		expandSecretReferences: expandSecretReferences(reads),
		listSecretValues: secretValues,
		listExportValues: listExportValues({ ...scopes, secretValues }),
	};
}

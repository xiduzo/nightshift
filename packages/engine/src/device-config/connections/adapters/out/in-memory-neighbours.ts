import type { SecretSource } from "../../../../secrets";
import type { ConnectionSecrets } from "../../application/ports";

/** What a test sets the secrets to answer: values by name, and the scopes that could not be read. */
export type SecretAnswers = {
	values?: Record<string, string>;
	sources?: Record<string, SecretSource>;
	unreachable?: boolean;
	projectUnreachable?: boolean;
	personalHere?: boolean;
};

/** The secrets of the connections, in memory: what a test sets, and what it was asked. */
export function inMemoryConnectionSecrets(answers: SecretAnswers = {}) {
	const resolved: string[][] = [];
	const noted: string[][] = [];
	const twin = {
		async resolveSecrets(request: { names: Iterable<string> }) {
			const names = [...request.names];
			resolved.push(names);
			const vars: Record<string, string | undefined> = {};
			for (const name of names) vars[name] = answers.values?.[name];
			return {
				vars,
				fromProject: new Set<string>(),
				unreachable: answers.unreachable ?? false,
				projectUnreachable: answers.projectUnreachable ?? false,
				personalHere: answers.personalHere ?? false,
			};
		},
		noteSecretUse(names: Iterable<string>) {
			noted.push([...names]);
		},
		secretSource: (name: string): SecretSource =>
			answers.sources?.[name] ??
			(answers.values?.[name] === undefined ? "missing" : "keychain"),
		/** The names of each resolve, in order. */
		resolved,
		/** The names of each noted use, in order. */
		noted,
	};
	return twin satisfies ConnectionSecrets;
}

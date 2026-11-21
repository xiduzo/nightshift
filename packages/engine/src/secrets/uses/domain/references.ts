/** `${NAME}`: an environment variable name, as a shell would read it. */
const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** The `${NAME}` references in these values, once each, in the order they come. */
export function referencesIn(values: Iterable<string>): string[] {
	const names = new Set<string>();
	for (const value of values) {
		for (const match of value.matchAll(REFERENCE)) {
			if (match[1]) names.add(match[1]);
		}
	}
	return [...names];
}

/** A value with each `${NAME}` replaced by its value in `vars`, or by nothing. */
export function expandReferences(
	value: string,
	vars: Readonly<Record<string, string | undefined>>,
): string {
	return value.replace(REFERENCE, (_, name: string) => vars[name] ?? "");
}

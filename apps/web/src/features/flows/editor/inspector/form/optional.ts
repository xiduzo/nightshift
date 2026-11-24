/** `from` with `key` set, or without it when `value` is undefined. */
export function withOptional<T extends object, K extends keyof T>(
	from: T,
	key: K,
	value: T[K] | undefined,
): T {
	const { [key]: _, ...rest } = from;
	return (value === undefined ? rest : { ...rest, [key]: value }) as T;
}

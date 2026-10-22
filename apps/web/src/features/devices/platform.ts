/** A user code as the device shows it: `ABCD-EFGH`. */
export function formatUserCode(code: string): string {
	return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

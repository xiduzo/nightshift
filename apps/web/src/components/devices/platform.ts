/** A platform as people say it: `darwin` is macOS. */
export function platformName(platform: string | null | undefined): string {
	switch (platform) {
		case "darwin":
			return "macOS";
		case "linux":
			return "Linux";
		case "win32":
			return "Windows";
		default:
			return platform || "Unknown system";
	}
}

/** A user code as the device shows it: `ABCD-EFGH`. */
export function formatUserCode(code: string): string {
	return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

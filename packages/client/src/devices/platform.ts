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

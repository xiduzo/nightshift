import {
	LaptopIcon,
	type LucideIcon,
	MonitorIcon,
	ServerIcon,
} from "lucide-react";

/**
 * The icon of a computer: a server for a Host or a Linux computer, a laptop
 * for a Mac or a Windows computer, else a monitor.
 */
export function deviceIcon(
	computer: { platform: string; host: { enabled: boolean } } | null,
): LucideIcon {
	if (!computer) return MonitorIcon;
	if (computer.host.enabled || computer.platform === "linux") return ServerIcon;
	if (computer.platform === "darwin" || computer.platform === "win32") {
		return LaptopIcon;
	}
	return MonitorIcon;
}

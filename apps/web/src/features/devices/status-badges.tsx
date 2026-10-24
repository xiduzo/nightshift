import { Badge } from "@nightshift/ui/components/badge";
import type { LinkedHost } from "@/shared/api";
import { formatRelative } from "@/shared/format";
import type { SpaceComputer } from "./space-view";

const ONLINE =
	"border-status-finished/40 bg-status-finished/10 text-status-finished";

/** Online, Offline or Access removed. Nothing when this computer cannot tell. */
export function ComputerStatus({ computer }: { computer: SpaceComputer }) {
	if (computer.paired?.revokedAt != null)
		return <Badge variant="outline">Access removed</Badge>;
	if (computer.online === null) return null;
	return computer.online ? (
		<Badge variant="outline" className={ONLINE}>
			Online
		</Badge>
	) : (
		<Badge variant="outline" className="text-muted-foreground">
			Offline
		</Badge>
	);
}

/** How a computer is now, in one sentence. */
export function computerLine(computer: SpaceComputer, now: number): string {
	if (computer.paired?.revokedAt != null)
		return "It can no longer sync with this computer.";
	if (computer.thisDevice) return "Night Shift runs here now.";
	if (computer.online) return "Connected now.";
	if (computer.lastSeenAt)
		return `Last seen ${formatRelative(computer.lastSeenAt, now)}.`;
	if (computer.online === false) return "Not connected yet.";
	return "Only its Host knows whether it is online.";
}

export function HostStatus({ status }: { status: LinkedHost["status"] }) {
	switch (status) {
		case "online":
			return (
				<Badge variant="outline" className={ONLINE}>
					Online
				</Badge>
			);
		case "connecting":
			return <Badge variant="outline">Connecting</Badge>;
		case "revoked":
			return <Badge variant="outline">Access removed</Badge>;
		default:
			return (
				<Badge variant="outline" className="text-muted-foreground">
					Offline
				</Badge>
			);
	}
}

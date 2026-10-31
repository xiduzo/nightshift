/** The items of a Service step: it starts the service, the service is ready, or it did not get ready. */
import { ServerCogIcon, ServerIcon, ServerOffIcon } from "lucide-react";
import type { ServiceItem } from "../transcript-items";
import { ResultCard } from "./parts";

const LOOK = {
	starting: {
		icon: ServerCogIcon,
		kicker: "Starts the service ·",
		tone: "text-muted-foreground",
	},
	ready: { icon: ServerIcon, kicker: "", tone: "text-status-finished" },
	failed: {
		icon: ServerOffIcon,
		kicker: "",
		tone: "text-status-failed",
	},
} as const;

/** What the service step did, and why a service did not get ready. */
export function ServiceCard({ item }: { item: ServiceItem }) {
	const look = LOOK[item.state];
	return (
		<ResultCard
			icon={look.icon}
			{...(look.kicker ? { kicker: look.kicker } : {})}
			value={
				item.state === "starting" ? (
					<code className="font-mono">{item.command}</code>
				) : item.state === "ready" ? (
					"The service is ready"
				) : (
					"The service did not get ready"
				)
			}
			tone={look.tone}
		>
			{item.state === "failed" && item.reason ? (
				<p className="break-words leading-relaxed">{item.reason}</p>
			) : null}
		</ResultCard>
	);
}

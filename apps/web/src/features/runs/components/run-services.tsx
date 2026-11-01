import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import { useQuery } from "@tanstack/react-query";
import { ServerIcon, ServerOffIcon } from "lucide-react";
import { useState } from "react";

import type { RunDetail } from "@/shared/api";
import { formatRelative } from "@/shared/format";
import { LocalTime } from "@/shared/time";
import { runQueries } from "../queries";

type RunService = RunDetail["services"][number];

/**
 * The services of a run (ADR 9): those that run now, or ran until the run
 * ended, each with its log.
 */
export function RunServices({ run }: { run: RunDetail }) {
	if (run.services.length === 0) return null;
	return (
		<ItemGroup className="gap-2">
			{run.services.map((service) => (
				<ServiceRow
					key={`${service.scopeKey}/${service.nodeId}`}
					runId={run.id}
					service={service}
				/>
			))}
		</ItemGroup>
	);
}

function ServiceRow({
	runId,
	service,
}: {
	runId: string;
	service: RunService;
}) {
	const [open, setOpen] = useState(false);
	const running = service.state === "running";
	const log = useQuery({
		...runQueries.serviceLog(runId, service, running && open),
		enabled: open,
	});
	const since = (
		<LocalTime at={service.since}>{formatRelative(service.since)}</LocalTime>
	);
	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<Item variant="outline" size="sm">
				<ItemMedia variant="icon">
					{running ? <ServerIcon /> : <ServerOffIcon />}
				</ItemMedia>
				<ItemContent>
					<ItemTitle>
						<span className="truncate font-mono">{service.nodeId}</span>
						<Badge variant={running ? "secondary" : "outline"}>
							{running ? "Runs" : "Stopped"}
						</Badge>
					</ItemTitle>
					<ItemDescription>
						{running ? (
							<>
								Started {since}. Night Shift stops it when the run{" "}
								{service.section === null
									? "ends"
									: `leaves the Section ${service.section}`}
								.
							</>
						) : (
							<>Started {since}. Night Shift stopped it when the run ended.</>
						)}
					</ItemDescription>
				</ItemContent>
				<ItemActions>
					<CollapsibleTrigger render={<Button variant="outline" size="sm" />}>
						{open ? "Hide log" : "Show log"}
					</CollapsibleTrigger>
				</ItemActions>
			</Item>
			<CollapsibleContent>
				<ScrollArea className="mt-2 h-64 rounded-md border bg-muted/40">
					<pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs">
						{log.isPending
							? "Loading the log…"
							: log.data?.text
								? log.data.text
								: "No log on this computer. The service printed nothing yet, or its run runs on another computer."}
					</pre>
				</ScrollArea>
			</CollapsibleContent>
		</Collapsible>
	);
}

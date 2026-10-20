import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
import { Spinner } from "@nightshift/ui/components/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { CircleCheckIcon, CircleXIcon } from "lucide-react";

import type { McpTestResult } from "@/shared/api";

/** The inline result of an MCP test: the server, its tools, or why it failed. */
export function McpTestOutcome({
	pending,
	result,
	error,
}: {
	pending: boolean;
	result: McpTestResult | undefined;
	error: Error | null;
}) {
	if (pending) {
		return (
			<p
				className="flex items-center gap-2 text-muted-foreground text-sm"
				aria-live="polite"
			>
				<Spinner />
				Connecting and listing tools…
			</p>
		);
	}
	if (error) {
		return (
			<Alert variant="destructive">
				<CircleXIcon />
				<AlertTitle>The test did not run</AlertTitle>
				<AlertDescription>{error.message}</AlertDescription>
			</Alert>
		);
	}
	if (!result) return null;
	if (!result.ok) {
		return (
			<Alert variant="destructive">
				<CircleXIcon />
				<AlertTitle>
					The test failed
					{result.ms > 0 ? (
						<span className="font-normal text-muted-foreground tabular-nums">
							{" "}
							· {result.ms} ms
						</span>
					) : null}
				</AlertTitle>
				<AlertDescription className="break-words">
					{result.error ?? "The server did not answer."}
				</AlertDescription>
			</Alert>
		);
	}
	return (
		<div className="flex flex-col gap-2" aria-live="polite">
			<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
				<CircleCheckIcon
					className="size-4 shrink-0 text-status-finished"
					aria-hidden
				/>
				<span>Connected to</span>
				<span className="font-mono text-xs">
					{result.server
						? `${result.server.name} v${result.server.version}`
						: "the server"}
				</span>
				<span className="text-muted-foreground tabular-nums">
					· {result.tools.length} {result.tools.length === 1 ? "tool" : "tools"}{" "}
					· {result.ms} ms
				</span>
			</p>
			{result.tools.length > 0 ? (
				<ul className="flex flex-wrap gap-1.5" aria-label="Tools">
					{result.tools.map((tool) => (
						<li key={tool.name} className="max-w-full">
							{tool.description ? (
								<Tooltip>
									<TooltipTrigger
										render={
											<Badge
												variant="outline"
												className="max-w-full font-mono"
											/>
										}
									>
										<span className="truncate">{tool.name}</span>
									</TooltipTrigger>
									<TooltipContent className="max-w-72">
										{tool.description}
									</TooltipContent>
								</Tooltip>
							) : (
								<Badge variant="outline" className="max-w-full font-mono">
									<span className="truncate">{tool.name}</span>
								</Badge>
							)}
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

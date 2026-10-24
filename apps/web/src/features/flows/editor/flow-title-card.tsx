import type { Flow } from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Card } from "@nightshift/ui/components/card";
import { cn } from "@nightshift/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { SettingsIcon } from "lucide-react";

/**
 * The flow over the top left of the canvas, like a page title: its name,
 * its description, what it gets and gives, the flows that call it, and the
 * button that opens its settings.
 */
export function FlowTitleCard({
	projectId,
	name,
	flow,
	callers,
	settingsOpen,
	onToggleSettings,
	className,
}: {
	projectId: string;
	name: string;
	flow: Flow;
	callers: string[];
	settingsOpen: boolean;
	onToggleSettings: () => void;
	className?: string;
}) {
	const outputs = flow.outputs ?? [];
	return (
		<Card size="sm" className={cn("gap-2 px-3 py-2.5 shadow-sm", className)}>
			<div className="flex min-w-0 items-center gap-2">
				<h1 className="min-w-0 truncate font-mono font-semibold text-base">
					{name}
				</h1>
				<Button
					variant={settingsOpen ? "secondary" : "ghost"}
					size="xs"
					className="ml-auto shrink-0"
					aria-pressed={settingsOpen}
					onClick={onToggleSettings}
				>
					<SettingsIcon data-icon="inline-start" />
					Flow settings
				</Button>
			</div>
			{flow.description ? (
				<p className="line-clamp-2 text-muted-foreground text-xs">
					{flow.description}
				</p>
			) : null}
			<div className="flex flex-wrap items-center gap-1 text-muted-foreground text-xs">
				<span className="mr-0.5">Gets</span>
				{flow.inputs.length === 0 ? (
					<span>no inputs</span>
				) : (
					flow.inputs.map((input) => (
						<Badge
							key={input.name}
							variant="outline"
							className="font-mono font-normal"
						>
							{input.name}
						</Badge>
					))
				)}
				{outputs.length > 0 ? (
					<>
						<span className="mr-0.5 ml-2">Gives</span>
						{outputs.map((output) => (
							<Badge
								key={output.name}
								variant="outline"
								className="font-mono font-normal"
							>
								{output.name}
							</Badge>
						))}
					</>
				) : null}
			</div>
			{callers.length > 0 ? (
				<div className="flex flex-wrap items-center gap-1 text-muted-foreground text-xs">
					<span>Called by</span>
					{callers.map((caller) => (
						<Button
							key={caller}
							variant="link"
							size="xs"
							className="h-auto px-0.5 font-mono text-muted-foreground hover:text-foreground"
							nativeButton={false}
							render={
								<Link
									to="/projects/$projectId/flows/$name"
									params={{ projectId, name: caller }}
								/>
							}
						>
							{caller}
						</Button>
					))}
				</div>
			) : null}
		</Card>
	);
}

import type { Flow } from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Link } from "@tanstack/react-router";

/**
 * The flow's inputs, like a function signature, its variables, and the
 * flows that call it.
 */
export function FlowSignature({
	projectId,
	inputs,
	variables,
	callers,
}: {
	projectId: string;
	inputs: Flow["inputs"];
	variables: NonNullable<Flow["variables"]>;
	callers: string[];
}) {
	if (inputs.length === 0 && variables.length === 0 && callers.length === 0)
		return null;
	return (
		<div className="ml-auto @xl:flex hidden min-w-0 items-center gap-3 text-muted-foreground text-xs">
			{inputs.length > 0 ? (
				<span
					className="flex min-w-0 items-center gap-1.5"
					title="The inputs of this flow"
				>
					<span className="shrink-0">Inputs</span>
					<span className="flex min-w-0 flex-wrap gap-1">
						{inputs.map((input) => (
							<Badge
								key={input.name}
								variant="outline"
								className="font-mono font-normal"
							>
								{input.name}
								{input.type === "json" ? (
									<span className="text-muted-foreground">: json</span>
								) : null}
							</Badge>
						))}
					</span>
				</span>
			) : null}
			{variables.length > 0 ? (
				<span
					className="flex min-w-0 items-center gap-1.5"
					title="The variables of this flow"
				>
					<span className="shrink-0">Variables</span>
					<span className="flex min-w-0 flex-wrap gap-1">
						{variables.map((variable) => (
							<Badge
								key={variable.name}
								variant="outline"
								className="font-mono font-normal"
							>
								{variable.name}
								<span className="text-muted-foreground">: {variable.type}</span>
							</Badge>
						))}
					</span>
				</span>
			) : null}
			{callers.length > 0 ? (
				<span className="flex min-w-0 items-center gap-1">
					<span className="shrink-0">Called by</span>
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
				</span>
			) : null}
		</div>
	);
}

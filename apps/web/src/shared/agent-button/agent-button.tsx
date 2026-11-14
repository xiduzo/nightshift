import {
	AGENT_ENTRIES,
	type AgentEntryId,
	type BuiltinAgentId,
	type BuiltinStatus,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SparklesIcon } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { builtinSettingsSearch } from "./answers";
import { builtinQueries } from "./queries";

/**
 * Who answers for one of Night Shift's own agents now. Undefined while it
 * loads, and where this computer does not say (you do not own it).
 */
export function useBuiltinAgent(id: BuiltinAgentId): BuiltinStatus | undefined {
	const agents = useQuery(builtinQueries.agents());
	return agents.data?.find((agent) => agent.id === id);
}

type ButtonProps = ComponentProps<typeof Button>;

/**
 * The one button that starts one of Night Shift's own agents. Its entry
 * names the agent and the words: "Ask why", "Improve this flow", "Build
 * with an agent", "Suggest prompt". Every such button has the same icon.
 *
 * When nothing can answer for its agent by default, the button stays. It
 * then opens the Settings page of that agent, and its tooltip says what is
 * wrong. Not when the person picked who answers beside it (`picked`).
 */
export function AgentButton({
	entry,
	field,
	link,
	picked = false,
	variant = "outline",
	size = "sm",
	...props
}: Omit<ButtonProps, "children" | "render" | "nativeButton"> & {
	entry: AgentEntryId;
	/** `field.suggest` only: the word of its field, "prompt" in "Suggest prompt". */
	field?: string;
	/** Where the button leads, as a link. Without it, `onClick` acts. */
	link?: ReactElement;
	/** The person picked who answers here, not the default: the button asks. */
	picked?: boolean;
}) {
	const { agent, label: words } = AGENT_ENTRIES[entry];
	const status = useBuiltinAgent(agent);
	const label = field ? `${words} ${field}` : words;
	const content = (
		<>
			<SparklesIcon data-icon="inline-start" />
			{label}
		</>
	);

	if (status?.problem && !props.disabled && !picked) {
		// Only what the button looks like stays: it leads to Settings now.
		const { className, id } = props;
		return (
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant={variant}
							size={size}
							id={id}
							className={className}
							nativeButton={false}
							render={
								<Link to="/settings" search={builtinSettingsSearch(agent)} />
							}
						/>
					}
				>
					{content}
				</TooltipTrigger>
				<TooltipContent className="max-w-72">
					{status.problem} Open Settings to fix it.
				</TooltipContent>
			</Tooltip>
		);
	}

	return (
		<Button
			variant={variant}
			size={size}
			{...props}
			{...(link ? { nativeButton: false, render: link } : {})}
		>
			{content}
		</Button>
	);
}

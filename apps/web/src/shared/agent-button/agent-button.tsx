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
import { cn } from "@nightshift/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SparklesIcon } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { answersLabel, builtinSettingsSearch } from "./answers";
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
 * When nothing can answer for its agent, the button stays. It then opens
 * the Settings page of that agent, and its tooltip says what is wrong.
 */
export function AgentButton({
	entry,
	field,
	link,
	variant = "outline",
	size = "sm",
	...props
}: Omit<ButtonProps, "children" | "render" | "nativeButton"> & {
	entry: AgentEntryId;
	/** `field.suggest` only: the word of its field, "prompt" in "Suggest prompt". */
	field?: string;
	/** Where the button leads, as a link. Without it, `onClick` acts. */
	link?: ReactElement;
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

	if (status?.problem && !props.disabled) {
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

/**
 * What answers for a built-in agent, as a quiet link to the Settings page
 * of that agent: the profile, or the harness and its model. With nothing
 * to answer, the link says to choose one.
 */
export function AnswersLink({
	agent,
	harnessLabel,
	className,
}: {
	agent: BuiltinAgentId;
	/** The name of a harness in the product. */
	harnessLabel: Parameters<typeof answersLabel>[1];
	className?: string;
}) {
	const status = useBuiltinAgent(agent);
	if (!status) return null;
	const label = status.answers
		? answersLabel(status.answers, harnessLabel)
		: "Choose an agent";
	return (
		<Button
			variant="link"
			size="xs"
			className={cn(
				"h-auto min-w-0 p-0 font-normal text-muted-foreground",
				className,
			)}
			title="Choose in Settings what answers"
			nativeButton={false}
			render={<Link to="/settings" search={builtinSettingsSearch(agent)} />}
		>
			<span className="truncate">{label}</span>
		</Button>
	);
}

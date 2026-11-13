/**
 * The parts of the tables that choose who answers: the frame of a table,
 * the picker's frame, the state of a row, your models as the picker lists
 * them, and the save of a pick. Every row uses the agent picker of the
 * chat. Its list holds your agents and your models together, and a row
 * offers only what can answer for it.
 */
import type { AssistantAgent } from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import {
	InputGroup,
	InputGroupAddon,
} from "@nightshift/ui/components/input-group";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { deciderQueries, profileQueries } from "@/features/agents";
import { deciderValue, profileValue } from "./builtin-answer";
import { type SettingsPatch, useSaveSettings } from "./hooks/use-settings-form";
import { builtinQueries } from "./queries";

export type ModelOption = {
	value: string;
	label: string;
	hint?: string;
	about?: string;
	group?: string;
};

/** The agent picker of the chat, handed in by the route. */
export type AgentPicker = (props: {
	purpose: "chat" | "suggest" | "run";
	choice: AssistantAgent;
	onChoiceChange: (choice: AssistantAgent) => void;
	agents?: boolean;
	effort?: boolean;
	models?: {
		label?: string;
		options: readonly ModelOption[];
		value: string | undefined;
		onPick: (value: string | undefined) => void;
		onOther?: () => void;
	};
}) => ReactNode;

/**
 * Saves a change of the settings at once. An error shows as a toast. Who
 * answers for each agent is read again: it follows the settings.
 */
export function useSaveNow() {
	const queryClient = useQueryClient();
	const save = useSaveSettings();
	return (patch: SettingsPatch) =>
		save.mutate(patch, {
			onError: (error) => toast.error(`Not saved: ${error.message}`),
			onSuccess: () =>
				void queryClient.invalidateQueries({
					queryKey: builtinQueries.status().queryKey,
				}),
		});
}

/** Your models: the model profiles, then the deciders of this computer. */
export function useModelOptions(): ModelOption[] {
	const profiles = useQuery(profileQueries.models());
	const deciders = useQuery(deciderQueries.list());
	return [
		...(profiles.data ?? []).map((profile) => ({
			value: profileValue(profile.name),
			label: profile.name,
			hint: profile.model ?? "default model",
			about:
				profile.description ||
				(deciders.data?.find((d) => d.name === profile.decider)?.label ??
					profile.decider),
			group: "Your model profiles",
		})),
		...(deciders.data ?? []).map((decider) => ({
			value: deciderValue(decider.name),
			label: decider.label,
			hint: decider.defaultModel ?? undefined,
			about:
				decider.apiKeySource === "missing" && decider.apiKey
					? `Needs the secret ${decider.apiKey}. Add it on the Secrets page.`
					: decider.address === "required"
						? "Needs the address of its server. Use a model profile."
						: decider.apiKey
							? "A provider. You pay for each answer."
							: "Runs on this computer. Free.",
			group: "Deciders",
		})),
	];
}

/** Ready, or what is wrong in a few words. The full sentence shows on hover and to a screen reader. */
export function State({
	problem,
	detail,
}: {
	/** Null: ready. */
	problem: string | null;
	/** What is wrong and how to fix it. */
	detail?: string | null;
}) {
	if (problem === null) {
		return (
			<Badge variant="outline" className="gap-1.5">
				<CircleCheckIcon className="text-status-finished" />
				Ready
			</Badge>
		);
	}
	const badge = (
		<Badge variant="outline" className="gap-1.5 text-status-waiting">
			<CircleAlertIcon />
			{problem}
		</Badge>
	);
	if (!detail) return badge;
	return (
		<Tooltip>
			<TooltipTrigger render={<span className="inline-flex" />}>
				{badge}
				<span className="sr-only">{detail}</span>
			</TooltipTrigger>
			<TooltipContent className="max-w-72">{detail}</TooltipContent>
		</Tooltip>
	);
}

/** The frame of the picker in a row. */
export function PickerFrame({ children }: { children: ReactNode }) {
	return (
		<InputGroup className="w-auto max-w-96">
			<InputGroupAddon>{children}</InputGroupAddon>
		</InputGroup>
	);
}

/** The table of the settings pages that choose who answers. */
export function AnswersTable({
	first,
	rows,
}: {
	/** The head of the first column. */
	first: string;
	rows: readonly {
		key: string;
		name: ReactNode;
		job: string;
		answersWith: ReactNode;
		state: ReactNode;
	}[];
}) {
	return (
		<div className="overflow-x-auto rounded-xl border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-72 px-3">{first}</TableHead>
						<TableHead className="px-3">Answers with</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((row) => (
						<TableRow key={row.key}>
							<TableCell className="px-3 py-2.5">
								<span className="font-medium">{row.name}</span>
								<div className="text-muted-foreground text-xs">{row.job}</div>
							</TableCell>
							<TableCell className="px-3 py-2.5">
								<div className="flex items-center gap-1">{row.answersWith}</div>
							</TableCell>
							<TableCell className="px-3 py-2.5 text-right">
								{row.state}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

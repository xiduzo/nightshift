/**
 * The agents step of adding the starter flows or importing a flow: each
 * agent the flows name (a harness and its model), and the profile of this
 * computer that takes its place. `prefilledProfile` of `@nightshift/flows`
 * fills each in, so the person only changes what they want.
 *
 * A peer port: the add-project form of `projects` shows it. It imports
 * only this vertical's queries and harnesses.
 */
import { agentKey, type FlowAgent, prefilledProfile } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@nightshift/ui/components/field";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "@nightshift/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { BotIcon } from "lucide-react";
import { useId, useState } from "react";
import type { AgentProfileRow } from "@/shared/api";
import { harnessInfo, useCustomAgents } from "./harnesses";
import { profileQueries } from "./queries";

/** The choice that keeps the agent the flow names. A profile's id holds no colon. */
const KEEP = ":keep";

/** One choice the import sends: your profile, by its id, for an agent of the flows. */
type AgentChoiceInput = FlowAgent & { profile: string };

/** Each agent of the flows, the profile that takes its place, and what an import sends. */
export type FlowAgentChoices = {
	rows: { key: string; agent: FlowAgent; profile: string }[];
	/** This computer's Agent Profiles. Empty when it has none, or you cannot see them. */
	profiles: AgentProfileRow[];
	loading: boolean;
	/** For the import: an agent you keep has none. */
	choices: AgentChoiceInput[];
	choose(key: string, profile: string): void;
};

/** The agents of the flows, each prefilled with one of your profiles until you choose. */
export function useFlowAgents(agents: readonly FlowAgent[]): FlowAgentChoices {
	const query = useQuery({
		...profileQueries.agents(),
		staleTime: 30_000,
		meta: { quietErrors: true },
	});
	const [chosen, setChosen] = useState<Record<string, string>>({});
	const profiles = query.data ?? [];
	const rows = agents.map((agent) => {
		const key = agentKey(agent);
		const picked = chosen[key];
		const profile =
			picked !== undefined &&
			(picked === KEEP || profiles.some((p) => p.id === picked))
				? picked
				: (prefilledProfile(agent, profiles)?.id ?? KEEP);
		return { key, agent, profile };
	});
	return {
		rows,
		profiles,
		loading: query.isPending,
		choices: rows.flatMap(({ agent, profile }) =>
			profile === KEEP ? [] : [{ ...agent, profile }],
		),
		choose: (key, profile) =>
			setChosen((current) => ({ ...current, [key]: profile })),
	};
}

/**
 * The step itself. With one profile, it is a line with Change: that
 * profile takes every agent. Without profiles, the agents stay.
 */
export function FlowAgentsStep({ step }: { step: FlowAgentChoices }) {
	const id = useId();
	const customAgents = useCustomAgents();
	const [open, setOpen] = useState(false);
	const label = (agent: FlowAgent) =>
		`${harnessInfo(agent.harness, customAgents).label} · ${agent.model}`;

	if (step.rows.length === 0 || step.loading) return null;
	if (step.profiles.length === 0) {
		return (
			<FieldDescription>
				The agents stay as they are. You can choose your own after you add them.
			</FieldDescription>
		);
	}
	const [only] = step.profiles;
	if (step.profiles.length === 1 && only && !open) {
		return (
			<Item variant="outline" size="sm">
				<ItemMedia variant="icon">
					<BotIcon />
				</ItemMedia>
				<ItemContent className="min-w-0">
					<ItemTitle>Agents</ItemTitle>
					<ItemDescription>
						Your profile {only.name} replaces every agent.
					</ItemDescription>
				</ItemContent>
				<ItemActions>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => setOpen(true)}
					>
						Change
					</Button>
				</ItemActions>
			</Item>
		);
	}
	const items = [
		...step.profiles.map((profile) => ({
			value: profile.id,
			label: profile.name,
		})),
		{ value: KEEP, label: "Keep this agent" },
	];
	return (
		<FieldSet>
			<FieldLegend variant="label">Agents</FieldLegend>
			<FieldDescription>
				Choose one of your profiles for each agent.
			</FieldDescription>
			<FieldGroup className="gap-3">
				{step.rows.map((row, index) => {
					return (
						<Field key={row.key}>
							<FieldLabel htmlFor={`${id}-${index}`}>
								{label(row.agent)}
							</FieldLabel>
							<Select
								items={items}
								value={row.profile}
								onValueChange={(value) => step.choose(row.key, value ?? KEEP)}
							>
								<SelectTrigger id={`${id}-${index}`} className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										{step.profiles.map((profile) => (
											<SelectItem key={profile.id} value={profile.id}>
												{profile.name}
												<span className="text-muted-foreground">
													{label(profile)}
												</span>
											</SelectItem>
										))}
									</SelectGroup>
									<SelectSeparator />
									<SelectGroup>
										<SelectItem value={KEEP}>Keep this agent</SelectItem>
									</SelectGroup>
								</SelectContent>
							</Select>
						</Field>
					);
				})}
			</FieldGroup>
		</FieldSet>
	);
}

/**
 * PROTOTYPE, throw away. The Settings area three ways, behind
 * `?variant=A..C` on `/settings`. `?data=` picks the computer to look at:
 * this one, or a sample. Choices stay in this tab: nothing is saved.
 *
 * The question: how does a person choose who answers for Night Shift's
 * six built-in agents, and how are they guided there?
 */
import { Button } from "@nightshift/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { NotificationSettingsCard } from "@/features/notifications";
import { PrototypeSwitcher } from "@/shared/prototype-switcher";
import { AgentDefaultsCard } from "../components/agent-defaults-card";
import { AppearanceCard } from "../components/appearance-card";
import { CleanupCard } from "../components/cleanup-card";
import { MeaningSearchCard } from "../components/meaning-search-card";
import { MonitoringCard } from "../components/monitoring-card";
import { PhoneCard } from "../components/phone-card";
import { RunPolicyCard } from "../components/run-policy-card";
import { RunsCard } from "../components/runs-card";
import { settingsQueries } from "../queries";
import { BUILTINS, SCENARIOS, SLOTS } from "./model";
import { type Proto, useProto } from "./use-proto";
import { MenuVariant } from "./variant-menu";
import { OverviewVariant } from "./variant-overview";
import { PathVariant } from "./variant-path";

const VARIANTS = [
	{ key: "A", name: "Side menu, three choices" },
	{ key: "B", name: "Overview and pages, a choice per agent" },
	{ key: "C", name: "Setup path, by what you can do" },
] as const;

export type ProtoSearch = {
	variant?: string;
	data?: string;
	section?: string;
	agent?: string;
};

/** The settings that exist today, for each variant to place. */
export type RealCards = {
	runs: ReactNode;
	yours: ReactNode;
	search: ReactNode;
	computer: ReactNode;
	you: ReactNode;
};

export type VariantProps = {
	proto: Proto;
	section: string | undefined;
	agent: string | undefined;
	real: RealCards;
	go: {
		/** The search of a link to a section or an agent, with the variant and the data kept. */
		to: (target: { section?: string; agent?: string }) => ProtoSearch;
	};
};

export function PrototypeSettings({
	search,
	thisComputer,
}: {
	search: ProtoSearch;
	thisComputer: ReactNode;
}) {
	const navigate = useNavigate();
	const variant = search.variant ?? "A";
	const proto = useProto(search.data);
	const settings = useQuery(settingsQueries.get());
	const data = settings.data;

	const real: RealCards = {
		runs: data ? (
			<>
				<RunsCard data={data} />
				<RunPolicyCard data={data} />
				<CleanupCard data={data} />
			</>
		) : null,
		yours: data ? <AgentDefaultsCard data={data} /> : null,
		search: data ? <MeaningSearchCard data={data} /> : null,
		computer: (
			<>
				{thisComputer}
				<PhoneCard />
				{data ? <MonitoringCard data={data} /> : null}
			</>
		),
		you: (
			<>
				<NotificationSettingsCard />
				<AppearanceCard />
			</>
		),
	};
	const props: VariantProps = {
		proto,
		section: search.section,
		agent: search.agent,
		real,
		go: {
			to: (target) => ({
				...(search.variant ? { variant: search.variant } : {}),
				...(search.data ? { data: search.data } : {}),
				...target,
			}),
		},
	};
	const scenario =
		SCENARIOS.find((item) => item.key === proto.scenario) ?? SCENARIOS[0];
	const nextScenario =
		SCENARIOS[(SCENARIOS.indexOf(scenario) + 1) % SCENARIOS.length];

	return (
		<>
			{variant === "B" ? (
				<OverviewVariant {...props} />
			) : variant === "C" ? (
				<PathVariant {...props} />
			) : (
				<MenuVariant {...props} />
			)}
			<StateDump proto={proto} />
			<PrototypeSwitcher variants={VARIANTS} current={variant}>
				<Button
					size="sm"
					variant="ghost"
					className="rounded-full font-mono text-xs hover:bg-zinc-800"
					onClick={() =>
						void navigate({
							to: "/settings",
							search: { ...search, data: nextScenario?.key },
							replace: true,
						})
					}
				>
					{scenario.name}
				</Button>
			</PrototypeSwitcher>
		</>
	);
}

/** The state behind the page, so a switch shows what changed. */
function StateDump({ proto }: { proto: Proto }) {
	return (
		<details className="fixed bottom-4 left-4 z-50 max-w-sm rounded-lg border-2 border-fuchsia-500 bg-zinc-950 p-2 font-mono text-xs text-zinc-50 shadow-2xl">
			<summary className="cursor-pointer">state</summary>
			<pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap">
				{[
					...SLOTS.map(
						(slot) =>
							`${slot.id}: ${proto.slotEngine(slot.id)?.name ?? "—"} (${proto.checkOf(slot.id)})`,
					),
					"",
					...BUILTINS.map((builtin) => {
						const state = proto.stateOf(builtin);
						return `${builtin.id}: ${state.ready ? `${state.engine.name} via ${state.via}` : state.text}`;
					}),
					"",
					`agents: ${proto.agents.map((e) => e.name).join(", ") || "—"}`,
					`models: ${proto.models.map((e) => e.name).join(", ") || "—"}`,
				].join("\n")}
			</pre>
		</details>
	);
}

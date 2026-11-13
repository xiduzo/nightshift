/**
 * PROTOTYPE, throw away. The state of the settings prototype: the agents
 * and models of the picked computer, which one fills each slot, and how
 * the check went. All of it lives in this tab.
 */
import { harnessTakesTools } from "@nightshift/flows";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { harnessInfo, profileQueries } from "@/features/agents";
import {
	BUILTINS,
	type Builtin,
	type BuiltinId,
	type Engine,
	fits,
	LOCAL_MODEL,
	SAMPLE_AGENTS,
	SAMPLES,
	type ScenarioKey,
	SLOTS,
	type SlotId,
} from "./model";

export type CheckState = "idle" | "running" | "ok" | "failed";

export type AgentState =
	| { ready: true; engine: Engine; via: string }
	| { ready: false; text: string; fix: "agent" | "model" | "engine" };

export type Proto = ReturnType<typeof useProto>;

export function useProto(data: string | undefined) {
	const scenario: ScenarioKey =
		data === "fresh" || data === "half" || data === "full" ? data : "live";
	const profiles = useQuery({
		...profileQueries.list(),
		enabled: scenario === "live",
	});

	const [added, setAdded] = useState<Record<string, Engine[]>>({});
	const [picked, setPicked] = useState<
		Record<string, Partial<Record<SlotId, string>>>
	>({});
	const [overrides, setOverrides] = useState<
		Record<string, Partial<Record<BuiltinId, string>>>
	>({});
	const [checks, setChecks] = useState<Record<string, CheckState>>({});
	const [decisionLater, setDecisionLater] = useState(false);

	const live: Engine[] = (profiles.data ?? []).map((profile) =>
		"harness" in profile
			? {
					id: `p:${profile.id}`,
					name: profile.name,
					kind: "agent" as const,
					detail: [harnessInfo(profile.harness).label, profile.model]
						.filter(Boolean)
						.join(" · "),
					takesTools: harnessTakesTools(profile.harness),
					ready: true,
				}
			: {
					id: `m:${profile.id}`,
					name: profile.name,
					kind: "model" as const,
					detail: [profile.decider, profile.model ?? "default model"].join(
						" · ",
					),
					takesTools: false,
					ready: true,
				},
	);
	const engines = [
		...(scenario === "live" ? live : SAMPLES[scenario]),
		...(added[scenario] ?? []),
	];
	const agents = engines.filter((engine) => engine.kind === "agent");
	const models = engines.filter((engine) => engine.kind === "model");
	const byId = (id: string | undefined) =>
		engines.find((engine) => engine.id === id);

	/** What a slot holds: the pick, else the first one that fits. Null: nothing fits. */
	const slotEngine = (slot: SlotId): Engine | null => {
		const takes = SLOTS.find((s) => s.id === slot)?.takes ?? "either";
		const chosen = byId(picked[scenario]?.[slot]);
		if (chosen && fits(takes, chosen).ok) return chosen;
		if (slot === "quick") return slotEngine("helper");
		if (slot === "decision" && decisionLater) return null;
		return engines.find((engine) => fits(takes, engine).ok) ?? null;
	};
	/** Quick with nothing picked follows Helper. */
	const quickFollows = !byId(picked[scenario]?.quick);

	const stateOf = (builtin: Builtin): AgentState => {
		const own = byId(overrides[scenario]?.[builtin.id]);
		const engine =
			own && fits(builtin.takes, own).ok ? own : slotEngine(builtin.slot);
		const via = own
			? "Its own choice"
			: (SLOTS.find((s) => s.id === builtin.slot)?.title ?? "");
		if (!engine) {
			return builtin.takes === "model"
				? { ready: false, text: "Choose a model", fix: "model" }
				: { ready: false, text: "Connect an agent", fix: "agent" };
		}
		if (!engine.ready) {
			return {
				ready: false,
				text: engine.problem ?? "Not ready",
				fix: "engine",
			};
		}
		return { ready: true, engine, via };
	};

	const ready = BUILTINS.filter((builtin) => stateOf(builtin).ready).length;

	return {
		scenario,
		loading: scenario === "live" && profiles.isPending,
		engines,
		agents,
		models,
		slotEngine,
		quickFollows,
		pick: (slot: SlotId, id: string | null) =>
			setPicked((now) => ({
				...now,
				[scenario]: { ...now[scenario], [slot]: id ?? undefined },
			})),
		overrideOf: (id: BuiltinId) => overrides[scenario]?.[id],
		override: (id: BuiltinId, engine: string | null) =>
			setOverrides((now) => ({
				...now,
				[scenario]: { ...now[scenario], [id]: engine ?? undefined },
			})),
		stateOf,
		ready,
		total: BUILTINS.length,
		decisionLater,
		setDecisionLater,
		/** Stands in for the real setup: adds a sample agent or the local model. */
		connect: (kind: "agent" | "model") =>
			setAdded((now) => {
				const have = now[scenario] ?? [];
				const more = (kind === "agent" ? SAMPLE_AGENTS : [LOCAL_MODEL]).filter(
					(engine) => !engines.some((e) => e.id === engine.id),
				);
				return { ...now, [scenario]: [...have, ...more] };
			}),
		checkOf: (slot: SlotId): CheckState =>
			checks[`${scenario}/${slot}`] ?? "idle",
		/** Stands in for one small question to each slot. */
		runCheck: () => {
			for (const slot of SLOTS) {
				const key = `${scenario}/${slot.id}`;
				const engine = slotEngine(slot.id);
				if (!engine) continue;
				setChecks((now) => ({ ...now, [key]: "running" }));
				window.setTimeout(
					() =>
						setChecks((now) => ({
							...now,
							[key]: engine.ready ? "ok" : "failed",
						})),
					700 + Math.random() * 1500,
				);
			}
		},
	};
}

/** The setup of an agent and of a decider, as hooks: what each can do here, the actions, and what follows when a job ends. */
import { useChanged } from "@nightshift/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { projectQueries } from "@/features/projects";
import {
	type AgentSetupJob,
	type AgentSetupStatus,
	type AgentSetupView,
	type DeciderSetupJob,
	type DeciderSetupStatus,
	type HarnessRowName,
	orpc,
} from "@/shared/api";
import {
	agentSetupMutations,
	agentSetupQueries,
	deciderSetupQueries,
	profileQueries,
} from "../queries";
import { allAnswer } from "./check-state";
import { justChosen, readyText } from "./decider-state";
import { type PathDone, pathDone } from "./setup-path";
import { ANSWERS_FOR, justReady, setupRuns } from "./setup-state";
import { useAgentChecks } from "./use-agent-checks";

/** What the setup can do here, and each agent's job. Quiet when it fails: what needs it hides. */
export function useAgentSetupStatus() {
	return useQuery({
		...agentSetupQueries.status(),
		meta: { quietErrors: true },
	});
}

/**
 * The actions of the setup. Each puts the job it started in the status,
 * so the status asks again until the job ends.
 */
export function useAgentSetupActions() {
	const queryClient = useQueryClient();
	const put = (view: AgentSetupView) =>
		queryClient.setQueryData(
			agentSetupQueries.status().queryKey,
			(old: AgentSetupStatus | undefined) =>
				old && {
					...old,
					agents: old.agents.map((agent) =>
						agent.harness === view.harness ? view : agent,
					),
				},
		);
	return {
		install: useMutation(agentSetupMutations.install({ onSuccess: put })),
		signIn: useMutation(agentSetupMutations.signIn({ onSuccess: put })),
		sendCode: useMutation(agentSetupMutations.sendCode({ onSuccess: put })),
		cancel: useMutation(
			agentSetupMutations.cancel({
				onSuccess: put,
				onError: (error) => toast.error(`Not stopped: ${error.message}`),
			}),
		),
	};
}

/** The job of a setup that made an agent ready, with its profile. */
type ReadyJob = Extract<AgentSetupJob, { state: "ready" }>;

/**
 * Follows the setup jobs. When one ends, the checks and the lists read
 * again. When one makes an agent ready, a toast says so and `onReady`
 * gets its profile. Mount it once per page: the dialog does.
 */
export function useSetupEnd(
	status: AgentSetupStatus | undefined,
	onReady: (ready: ReadyJob) => void,
) {
	const changed = useChanged({ orpc });
	const seen = useRef(new Map<HarnessRowName, AgentSetupJob>());
	useEffect(() => {
		for (const agent of status?.agents ?? []) {
			const before = seen.current.get(agent.harness);
			seen.current.set(agent.harness, agent.job);
			if (!before || !setupRuns(before) || setupRuns(agent.job)) continue;
			// The job added a harness and a profile, or found the agent.
			changed("device", "programs");
			const ready = justReady(before, agent.job);
			if (!ready) continue;
			toast.success(`${agent.label} is ready`, {
				description: `The profile ${ready.profileName} uses it. ${ANSWERS_FOR}`,
			});
			onReady(ready);
		}
	}, [status, changed, onReady]);
}

/** The setup of a decider: the choices, and how a job goes. Quiet when it fails. */
export function useDeciderSetupStatus() {
	return useQuery({
		...deciderSetupQueries.status(),
		meta: { quietErrors: true },
	});
}

/** After a decider is chosen: a toast, and the lists that name it read again. */
export function useDeciderChosen() {
	const changed = useChanged({ orpc });
	return useCallback(
		(decider: string) => {
			toast.success("The decider is ready", {
				description: readyText(decider),
			});
			// The settings and a Model Profile name it, and Ollama has its model.
			changed("device", "ollama");
		},
		[changed],
	);
}

/**
 * Follows the decider job. When a download ends with the decider ready,
 * `onChosen` says so, also while the dialog is closed.
 */
export function useDeciderEnd(
	status: DeciderSetupStatus | undefined,
	onChosen: (decider: string) => void,
) {
	const seen = useRef<DeciderSetupJob | undefined>(undefined);
	useEffect(() => {
		if (!status) return;
		const before = seen.current;
		seen.current = status.job;
		const ready = justChosen(before, status.job);
		if (ready) onChosen(ready.decider);
	}, [status, onChosen]);
}

/**
 * Which steps of the setup are done on this computer. With `enabled`
 * false it does not ask who answers for Night Shift's agents.
 */
export function useSetupDone(enabled = true): PathDone {
	const profiles = useQuery({
		...profileQueries.agents(),
		meta: { quietErrors: true },
	});
	const decider = useDeciderSetupStatus();
	const projects = useQuery({
		...projectQueries.list(),
		meta: { quietErrors: true },
	});
	const { summary } = useAgentChecks(enabled);
	return pathDone({
		profiles: profiles.data?.length ?? 0,
		decider: decider.data,
		checked: allAnswer(summary),
		projects: projects.data?.length,
	});
}

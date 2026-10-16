import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { useOpenGates } from "@/hooks/use-open-gates";
import type { OpenGate, RunStatus, RunSummary } from "@/lib/api-types";
import { orpc } from "@/utils/orpc";

/** How often the runs are read for a change of status. */
const RUNS_POLL_MS = 10_000;

/** True when this browser can show desktop notifications. */
export function notificationsSupported(): boolean {
	return typeof window !== "undefined" && "Notification" in window;
}

const gateKey = (gate: OpenGate) => `${gate.runId}:${gate.stepId}`;

/**
 * Desktop notifications on this Mac: a Gate opens, a run finishes, a run
 * fails. Each kind is on or off in the settings. It polls the open Gates and
 * the runs (the same queries the inbox and the home page use, so they share
 * the cache) and compares with the last poll. What was there on the first
 * load is the baseline: it never notifies. It shows nothing until the browser
 * has permission. Mount it once.
 */
export function useNightNotifications() {
	const navigate = useNavigate();
	const settings = useQuery({
		...orpc.settings.get.queryOptions(),
		meta: { quietErrors: true },
	});
	const gates = useOpenGates();
	const runs = useQuery({
		...orpc.runs.list.queryOptions({ input: {} }),
		refetchInterval: RUNS_POLL_MS,
		meta: { quietErrors: true },
	});

	const seenGates = useRef<Set<string> | null>(null);
	const runStatus = useRef<Map<string, RunStatus> | null>(null);
	const values = settings.data?.values;

	useEffect(() => {
		if (!gates.data) return;
		const before = seenGates.current;
		seenGates.current = new Set(gates.data.map(gateKey));
		if (!before || !values?.notifyGateOpened) return;
		for (const gate of gates.data) {
			if (before.has(gateKey(gate))) continue;
			show({
				title: `${gate.projectName}: a Gate waits for you`,
				body: `${gate.runTitle}\n${gate.question}`,
				tag: `gate:${gateKey(gate)}`,
				onClick: () => void navigate({ to: "/inbox" }),
			});
		}
	}, [gates.data, values?.notifyGateOpened, navigate]);

	useEffect(() => {
		if (!runs.data) return;
		const before = runStatus.current;
		runStatus.current = new Map(runs.data.map((run) => [run.id, run.status]));
		if (!before) return;
		for (const run of runs.data) {
			const was = before.get(run.id);
			if (was === run.status) continue;
			const note = runNotice(run);
			if (!note) continue;
			if (run.status === "finished" && !values?.notifyRunFinished) continue;
			if (run.status === "failed" && !values?.notifyRunFailed) continue;
			show({
				...note,
				tag: `run:${run.id}:${run.status}`,
				onClick: () =>
					void navigate({ to: "/runs/$runId", params: { runId: run.id } }),
			});
		}
	}, [runs.data, values?.notifyRunFinished, values?.notifyRunFailed, navigate]);
}

function runNotice(
	run: RunSummary,
): { title: string; body: string } | undefined {
	if (run.status === "finished") {
		return {
			title: "A run finished",
			body: run.reason ? `${run.title}\nEnded on ${run.reason}` : run.title,
		};
	}
	if (run.status === "failed") {
		return {
			title: "A run failed",
			body: run.reason ? `${run.title}\n${run.reason}` : run.title,
		};
	}
	return undefined;
}

function show({
	title,
	body,
	tag,
	onClick,
}: {
	title: string;
	body: string;
	tag: string;
	onClick: () => void;
}) {
	if (!notificationsSupported() || Notification.permission !== "granted") {
		return;
	}
	try {
		const notification = new Notification(title, { body, tag });
		notification.onclick = () => {
			window.focus();
			onClick();
			notification.close();
		};
	} catch {
		// Some browsers allow notifications only from a service worker.
	}
}

/** Mounts the desktop notifications. Renders nothing. */
export function NightNotifications() {
	useNightNotifications();
	return null;
}

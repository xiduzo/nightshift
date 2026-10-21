import {
	compareGates,
	compareRuns,
	describeNotice,
	isWanted,
} from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { useOpenGates } from "@/features/gates";
import { runQueries } from "@/features/runs";
import { notificationsSupported, settingsQueries } from "@/features/settings";
import type { RunStatus } from "@/shared/api";

/**
 * Desktop notifications on this Mac: a Gate opens, a run finishes, a run
 * fails. Each kind is on or off in the settings. It polls the open Gates and
 * the runs (the same queries the inbox and the home page use, so they share
 * the cache) and compares with the last poll (`compareGates`, `compareRuns`).
 * What was there on the first load is the baseline: it never notifies. It
 * shows nothing until the browser has permission. Mount it once.
 */
export function useNightNotifications() {
	const navigate = useNavigate();
	const settings = useQuery({
		...settingsQueries.get(),
		meta: { quietErrors: true },
	});
	const gates = useOpenGates();
	const runs = useQuery(runQueries.everyRunForNotifications());

	const seenGates = useRef<Set<string> | null>(null);
	const runStatus = useRef<Map<string, RunStatus> | null>(null);
	const values = settings.data?.values;

	useEffect(() => {
		if (!gates.data) return;
		const { seen, notices } = compareGates(seenGates.current, gates.data);
		seenGates.current = seen;
		const choices = { notifyGateOpened: values?.notifyGateOpened };
		for (const notice of notices) {
			if (notice.kind !== "gate-opened" || !isWanted(notice, choices)) continue;
			// The inbox shows the Gate of any Space: open it there.
			const gate = notice.gate.stepId;
			show({
				...describeNotice(notice),
				onClick: () => void navigate({ to: "/inbox", search: { gate } }),
			});
		}
	}, [gates.data, values?.notifyGateOpened, navigate]);

	useEffect(() => {
		if (!runs.data) return;
		const { seen, notices } = compareRuns(runStatus.current, runs.data);
		runStatus.current = seen;
		const choices = {
			notifyRunFinished: values?.notifyRunFinished,
			notifyRunFailed: values?.notifyRunFailed,
		};
		for (const notice of notices) {
			if (notice.kind === "gate-opened" || !isWanted(notice, choices)) continue;
			const runId = notice.run.id;
			show({
				...describeNotice(notice),
				onClick: () => void navigate({ to: "/runs/$runId", params: { runId } }),
			});
		}
	}, [runs.data, values?.notifyRunFinished, values?.notifyRunFailed, navigate]);
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

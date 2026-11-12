import {
	createRunQueries,
	knownUseful,
	type RunDetail,
	type RunStatus,
	rememberedUseful,
	rememberUseful,
	USEFUL_ERROR,
	USEFUL_HINT,
	USEFUL_QUESTION,
	usefulLabel,
	usefulView,
} from "@nightshift/client";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Card, CardContent } from "@nightshift/ui-native/components/ui/card";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { View } from "react-native";

import { useHostQueries } from "@/features/host";

/**
 * One tap on a finished run: was it useful? After it lands, the card
 * shows the choice and does not ask again. `status` is the one the screen
 * shows, an action on its way too. A test run does not ask.
 */
export function RunUseful({
	run,
	status,
}: {
	run: RunDetail;
	status: RunStatus;
}) {
	const queries = useHostQueries(createRunQueries);
	const [sending, setSending] = useState<boolean | null>(null);
	const [failed, setFailed] = useState(false);
	// Read again after a save, so the choice shows at once.
	const [, setSaved] = useState(0);
	const busy = useRef(false);
	const mark = useMutation(queries.useful());
	const known = knownUseful(run.metrics?.scores, rememberedUseful(run.id));
	const view = usefulView(status, known, run);

	const choose = (useful: boolean) => {
		if (busy.current) return;
		busy.current = true;
		setFailed(false);
		setSending(useful);
		mark.mutate(
			{ runId: run.id, useful },
			{
				onSuccess: () => {
					rememberUseful(run.id, useful);
					busy.current = false;
					setSending(null);
					setSaved((n) => n + 1);
				},
				onError: () => {
					busy.current = false;
					setSending(null);
					setFailed(true);
				},
			},
		);
	};

	if (view === "hidden") return null;
	if (view !== "ask") {
		return (
			<Text className="text-muted-foreground text-sm">{usefulLabel(view)}</Text>
		);
	}

	return (
		<Card className="py-4">
			<CardContent className="gap-3 px-4">
				<Text className="font-medium">{USEFUL_QUESTION}</Text>
				<View className="flex-row flex-wrap gap-2">
					<Button
						variant="outline"
						disabled={sending !== null}
						accessibilityState={{
							disabled: sending !== null,
							busy: sending === true,
						}}
						onPress={() => choose(true)}
						className="h-auto min-h-11 px-4"
					>
						<Text>Yes</Text>
					</Button>
					<Button
						variant="outline"
						disabled={sending !== null}
						accessibilityState={{
							disabled: sending !== null,
							busy: sending === false,
						}}
						onPress={() => choose(false)}
						className="h-auto min-h-11 px-4"
					>
						<Text>No</Text>
					</Button>
				</View>
				<Text
					accessibilityRole={failed ? "alert" : undefined}
					className={
						failed
							? "text-destructive text-sm"
							: "text-muted-foreground text-sm"
					}
				>
					{failed ? USEFUL_ERROR : USEFUL_HINT}
				</Text>
			</CardContent>
		</Card>
	);
}

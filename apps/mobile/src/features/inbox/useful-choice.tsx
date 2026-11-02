import { createRunQueries } from "@nightshift/client";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { View } from "react-native";

import { useHostQueries, useSignedIn } from "@/features/host";
import {
	knownUseful,
	rememberedUseful,
	rememberUseful,
	USEFUL_ERROR,
	USEFUL_HINT,
	usefulLabel,
	usefulView,
} from "./useful";
import { usefulOptions } from "./useful-mutation";

/**
 * One tap on a pull request in the morning digest. After it lands, the
 * row shows Yes or No and does not ask again.
 */
export function UsefulChoice({
	run,
}: {
	run: { runId: string; prUrl: string | null };
}) {
	const { host } = useSignedIn();
	const queries = useHostQueries(createRunQueries);
	const [sending, setSending] = useState<boolean | null>(null);
	const [failed, setFailed] = useState(false);
	const busy = useRef(false);
	const mark = useMutation(usefulOptions(host.orpc, queries));
	const known = knownUseful(run, rememberedUseful(run.runId));
	const view = usefulView(run, known);

	const choose = (useful: boolean) => {
		if (busy.current) return;
		busy.current = true;
		setFailed(false);
		setSending(useful);
		mark.mutate(
			{ runId: run.runId, useful },
			{
				onSuccess: () => {
					rememberUseful(run.runId, useful);
					busy.current = false;
					setSending(null);
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
		return <Text className="text-sm">{usefulLabel(view)}</Text>;
	}

	return (
		<View className="gap-2">
			<Text className="font-medium text-sm">Useful?</Text>
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
					failed ? "text-destructive text-sm" : "text-muted-foreground text-sm"
				}
			>
				{failed ? USEFUL_ERROR : USEFUL_HINT}
			</Text>
		</View>
	);
}

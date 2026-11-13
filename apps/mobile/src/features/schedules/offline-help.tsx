import { scheduleName } from "@nightshift/client";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { Moon } from "lucide-react-native";
import { View } from "react-native";

import { ErrorAlert } from "@/shared/feedback";
import type { OfflineNotice } from "./tonight";
import { useScheduleNudges } from "./use-nudges";
import type { Tonight } from "./use-tonight";

/**
 * On Computers: each schedule that needs an offline computer tonight, and
 * Pause tonight for it. Nothing when every computer tonight needs is on.
 */
export function OfflineHelp({ tonight }: { tonight: Tonight }) {
	if (tonight.notices.length === 0) return null;
	return (
		<View className="gap-4">
			{tonight.notices.map((notice) => (
				<PauseForComputer key={notice.key} notice={notice} />
			))}
		</View>
	);
}

function PauseForComputer({ notice }: { notice: OfflineNotice }) {
	const { entry } = notice;
	const nudges = useScheduleNudges(entry.projectId, entry.schedule);
	return (
		<View className="gap-3">
			<Text className="text-muted-foreground text-sm">
				{`${notice.sentence} Turn it on before then, or pause the flow for tonight.`}
			</Text>
			{nudges.hidden ? null : (
				<Button
					size="lg"
					variant="secondary"
					disabled={nudges.pausing}
					className="h-auto min-h-11 py-2"
					onPress={nudges.pause}
				>
					<Icon as={Moon} />
					<Text>{`Pause ${scheduleName(entry.schedule)} tonight`}</Text>
				</Button>
			)}
			{nudges.copy ? (
				<ErrorAlert
					title={nudges.copy.title}
					message={nudges.copy.message}
					fix={nudges.copy.fix}
				/>
			) : null}
		</View>
	);
}

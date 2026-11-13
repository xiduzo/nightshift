import { CircleAlert } from "lucide-react-native";

import {
	NativeButtonRow,
	NativeSection,
	NativeTextRow,
} from "@/shared/native-list";
import { useThemeColors } from "@/shared/theme";

/**
 * What went wrong, as a group of a native list page: a title that says
 * what happened, the reason and how to fix it. With `onRetry`, a "Try
 * again" row. A page that is a `NativeList` takes this, not ErrorAlert.
 */
export function ErrorSection({
	title,
	message,
	fix,
	onRetry,
}: {
	title: string;
	/** The reason, often the Host's own message. */
	message: string;
	/** How the person fixes it. */
	fix?: string;
	onRetry?: () => void;
}) {
	const { colors } = useThemeColors();
	return (
		<NativeSection>
			<NativeTextRow
				icon={{ sf: "exclamationmark.circle.fill", lucide: CircleAlert }}
				iconColor={colors.destructive}
				text={`**${title}**`}
				note={[message, fix].filter(Boolean).join(" ")}
			/>
			{onRetry ? <NativeButtonRow label="Try again" onPress={onRetry} /> : null}
		</NativeSection>
	);
}

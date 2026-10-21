import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui-native/components/ui/alert";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { CircleAlert } from "lucide-react-native";

/**
 * What went wrong, in the page: a title that says what happened, the
 * reason, and how to fix it. With `onRetry`, a "Try again" button.
 */
export function ErrorAlert({
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
	return (
		<Alert icon={CircleAlert} variant="destructive">
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>{message}</AlertDescription>
			{fix ? <AlertDescription>{fix}</AlertDescription> : null}
			{onRetry ? (
				<Button
					variant="outline"
					size="sm"
					className="mt-2 self-start"
					onPress={onRetry}
				>
					<Text>Try again</Text>
				</Button>
			) : null}
		</Alert>
	);
}

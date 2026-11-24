import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { CircleAlertIcon } from "lucide-react";

/** What did not work, and why, in the page. Nothing without an error. */
export function ErrorAlert({
	title,
	error,
}: {
	/** What happened: "Not saved". */
	title: string;
	error: { message: string } | null | undefined;
}) {
	if (!error) return null;
	return (
		<Alert variant="destructive">
			<CircleAlertIcon />
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>{error.message}</AlertDescription>
		</Alert>
	);
}

import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Switch } from "@nightshift/ui/components/switch";
import { LockIcon } from "lucide-react";
import { useId } from "react";

/**
 * "Send anonymous usage" on this computer. `description` is the card's
 * explanation. The first-start notice already says you can turn it off.
 */
export function UsageSwitch({
	checked,
	locked,
	pending,
	onCheckedChange,
	description = false,
}: {
	checked: boolean;
	locked: string | undefined;
	pending: boolean;
	onCheckedChange: (checked: boolean) => void;
	description?: boolean;
}) {
	const id = useId();
	const lockId = locked ? `${id}-lock` : undefined;

	return (
		<>
			<Field orientation="horizontal" data-disabled={locked ? true : undefined}>
				<FieldContent>
					<FieldLabel htmlFor={id}>Send anonymous usage</FieldLabel>
					{description ? (
						<FieldDescription>
							Night Shift sends anonymous counts of how you use it. You can turn
							this off.
						</FieldDescription>
					) : null}
				</FieldContent>
				<Switch
					id={id}
					checked={checked}
					disabled={Boolean(locked) || pending}
					aria-describedby={lockId}
					onCheckedChange={onCheckedChange}
				/>
			</Field>
			{locked ? (
				<Alert id={lockId}>
					<LockIcon />
					<AlertTitle>You cannot change this here</AlertTitle>
					<AlertDescription>{locked}</AlertDescription>
				</Alert>
			) : null}
		</>
	);
}

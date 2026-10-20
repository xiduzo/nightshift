import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldGroup,
	FieldLabel,
	FieldSeparator,
} from "@nightshift/ui/components/field";
import { Switch } from "@nightshift/ui/components/switch";
import { BellOffIcon, CircleAlertIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { SettingsView } from "@/shared/api";
import { PageSection } from "@/shared/page";
import { useToggleSetting } from "../hooks/use-settings-form";
import { notificationsSupported } from "../notifications";

type Permission = NotificationPermission | "unsupported";

const NOTIFICATIONS: {
	key: "notifyGateOpened" | "notifyRunFinished" | "notifyRunFailed";
	label: string;
	description: string;
}[] = [
	{
		key: "notifyGateOpened",
		label: "A Gate opens",
		description: "A run waits for your answer.",
	},
	{
		key: "notifyRunFinished",
		label: "A run finishes",
		description: "With the outcome it ended on.",
	},
	{
		key: "notifyRunFailed",
		label: "A run fails",
		description: "With the reason it failed.",
	},
];

export function NotificationsCard({ data }: { data: SettingsView }) {
	const id = useId();
	const toggle = useToggleSetting();
	const [permission, setPermission] = useState<Permission | null>(null);

	useEffect(() => {
		setPermission(
			notificationsSupported() ? Notification.permission : "unsupported",
		);
	}, []);

	async function ask() {
		if (!notificationsSupported()) return;
		setPermission(await Notification.requestPermission());
	}

	const anyOn = NOTIFICATIONS.some(({ key }) => data.values[key]);

	return (
		<PageSection
			title="Notifications on this Mac"
			description="This browser shows them while Night Shift is open in a tab. Each switch saves at once."
		>
			<Card>
				<CardContent>
					<FieldGroup>
						{permission === "denied" && anyOn ? (
							<Alert>
								<BellOffIcon />
								<AlertTitle>This browser blocks notifications</AlertTitle>
								<AlertDescription>
									Allow notifications for this site in the browser's site
									settings (the icon left of the address). On macOS, also allow
									the browser in System Settings, Notifications.
								</AlertDescription>
							</Alert>
						) : permission === "unsupported" ? (
							<Alert>
								<BellOffIcon />
								<AlertTitle>No notifications in this browser</AlertTitle>
								<AlertDescription>
									This browser cannot show desktop notifications.
								</AlertDescription>
							</Alert>
						) : permission === "default" && anyOn ? (
							<Alert>
								<CircleAlertIcon />
								<AlertTitle>The browser has not allowed them yet</AlertTitle>
								<AlertDescription>
									Nothing shows until you allow notifications for this site.
								</AlertDescription>
								<AlertAction>
									<Button
										size="sm"
										variant="outline"
										onClick={() => void ask()}
									>
										Allow
									</Button>
								</AlertAction>
							</Alert>
						) : null}
						{NOTIFICATIONS.map(({ key, label, description }, index) => (
							<div key={key} className="contents">
								{index > 0 ? <FieldSeparator /> : null}
								<Field orientation="horizontal">
									<FieldContent>
										<FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
										<FieldDescription>{description}</FieldDescription>
									</FieldContent>
									<Switch
										id={`${id}-${key}`}
										checked={data.values[key]}
										disabled={permission === "unsupported"}
										onCheckedChange={(checked) => {
											if (checked && permission === "default") void ask();
											toggle.mutate({ [key]: checked });
										}}
									/>
								</Field>
							</div>
						))}
					</FieldGroup>
				</CardContent>
			</Card>
		</PageSection>
	);
}

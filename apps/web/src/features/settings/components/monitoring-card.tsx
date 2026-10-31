import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
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
import { InfoIcon } from "lucide-react";
import { useId } from "react";
import type { SettingsView } from "@/shared/api";
import { PageSection } from "@/shared/page";
import { useSettingsForm, useToggleSetting } from "../hooks/use-settings-form";
import {
	CardForm,
	HeadersCard,
	ResetSection,
	SaveError,
	SelectSetting,
	TextSetting,
} from "./setting-fields";

const MONITORING_KEYS = ["telemetryEndpoint", "telemetryProtocol"] as const;

const FORMATS = [
	{ value: "http/protobuf", label: "Protobuf (most tools)" },
	{ value: "http/json", label: "JSON" },
] as const;

/** "Send runs to your monitoring": off by default, an address, a format and headers. */
export function MonitoringCard({ data }: { data: SettingsView }) {
	const form = useSettingsForm(data, MONITORING_KEYS, { title: "Monitoring" });
	const toggle = useToggleSetting("Monitoring");
	const id = useId();
	const on = data.values.telemetry;
	const noAddress = on && data.values.telemetryEndpoint.trim() === "";

	return (
		<PageSection
			title="Monitoring"
			description="Send your runs to a monitoring tool you choose, such as Grafana. Nothing leaves this computer until you turn it on."
			actions={<ResetSection form={form} />}
		>
			<Card>
				<CardForm form={form}>
					<CardContent>
						<FieldGroup>
							<Field orientation="horizontal">
								<FieldContent>
									<FieldLabel htmlFor={`${id}-telemetry`}>
										Send runs to your monitoring
									</FieldLabel>
									<FieldDescription>
										Night Shift sends each run with its steps, time, tokens and
										cost. Claude Code steps send their own usage there too.
										Prompts and replies stay on this computer.
									</FieldDescription>
								</FieldContent>
								<Switch
									id={`${id}-telemetry`}
									checked={on}
									disabled={toggle.isPending}
									onCheckedChange={(checked) =>
										toggle.mutate({ telemetry: checked })
									}
								/>
							</Field>
							{noAddress ? (
								<Alert>
									<InfoIcon />
									<AlertTitle>Add an address</AlertTitle>
									<AlertDescription>
										Night Shift starts to send your runs when you add the
										address of your monitoring tool.
									</AlertDescription>
								</Alert>
							) : null}
							<FieldSeparator />
							<div className="grid gap-6 sm:grid-cols-2">
								<TextSetting
									form={form}
									settingKey="telemetryEndpoint"
									label="Address"
									placeholder="http://localhost:4318"
									description="Where your tool takes OpenTelemetry data, for example http://localhost:4318."
									mono
								/>
								<SelectSetting
									form={form}
									settingKey="telemetryProtocol"
									label="Format"
									description="Use protobuf unless your tool asks for JSON."
									options={FORMATS}
								/>
							</div>
							<SaveError error={form.saveError} />
						</FieldGroup>
					</CardContent>
				</CardForm>
			</Card>
			{/* A new saved value, from here or another screen, starts a new draft. */}
			<HeadersCard
				key={JSON.stringify(data.values.telemetryHeaders)}
				settingKey="telemetryHeaders"
				saved={data.values.telemetryHeaders}
				description={
					<>
						Add the headers your tool needs, such as an API key. Write a key as{" "}
						<span className="font-mono">${"{NAME}"}</span> and save its value on
						the Secrets page.
					</>
				}
				valuePlaceholder="Bearer ${GRAFANA_TOKEN}"
			/>
		</PageSection>
	);
}

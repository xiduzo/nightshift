import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { InfoIcon, LockIcon } from "lucide-react";
import { useId, useState } from "react";
import { SpaceUsageSection } from "@/features/spaces";
import type { SettingsView } from "@/shared/api";
import { PageSection, SettingNote, SettingRows } from "@/shared/page";
import { useSettingsForm, useToggleSetting } from "../hooks/use-settings-form";
import { readUsage, usagePatch } from "../usage-setting";
import {
	CardForm,
	HeadersCard,
	ResetSection,
	SaveErrorRow,
	SelectSetting,
	SwitchSetting,
	TextSetting,
} from "./setting-fields";
import { UsageSendsButton, UsageSendsSheet } from "./usage-sends-sheet";

const MONITORING_KEYS = ["telemetryEndpoint", "telemetryProtocol"] as const;

const FORMATS = [
	{ value: "http/protobuf", label: "Protobuf (most tools)" },
	{ value: "http/json", label: "JSON" },
] as const;

/** "Send runs to your monitoring", and anonymous usage for this computer. */
export function MonitoringCard({ data }: { data: SettingsView }) {
	const form = useSettingsForm(data, MONITORING_KEYS, { title: "Monitoring" });
	const toggle = useToggleSetting("Monitoring");
	const id = useId();
	const [sends, setSends] = useState(false);
	const on = data.values.telemetry;
	const usage = readUsage(data);
	const noAddress = on && data.values.telemetryEndpoint.trim() === "";

	return (
		<>
			<PageSection
				title="Monitoring"
				description="Send your runs to a monitoring tool you choose, such as Grafana. Nothing leaves this computer until you turn it on."
				actions={<ResetSection form={form} />}
			>
				<CardForm form={form}>
					<SettingRows>
						<SwitchSetting
							label="Send runs to your monitoring"
							description="Night Shift sends each run with its steps, time, tokens and cost. Claude Code steps send their own usage there too. Prompts and replies stay on this computer."
							checked={on}
							disabled={toggle.isPending}
							onCheckedChange={(checked) =>
								toggle.mutate({ telemetry: checked })
							}
						/>
						{noAddress ? (
							<SettingNote>
								<Alert>
									<InfoIcon />
									<AlertTitle>Add an address</AlertTitle>
									<AlertDescription>
										Night Shift starts to send your runs when you add the
										address of your monitoring tool.
									</AlertDescription>
								</Alert>
							</SettingNote>
						) : null}
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
						<SaveErrorRow error={form.saveError} />
						<SwitchSetting
							label="Send anonymous usage"
							description="Night Shift sends anonymous counts of how you use it. You can turn this off."
							checked={usage.on}
							disabled={Boolean(usage.locked) || toggle.isPending}
							describedBy={usage.locked ? `${id}-usage-lock` : undefined}
							onCheckedChange={(checked) =>
								toggle.mutate(usagePatch({ usage: checked }))
							}
						/>
						{usage.locked ? (
							<SettingNote>
								<Alert id={`${id}-usage-lock`}>
									<LockIcon />
									<AlertTitle>You cannot change this here</AlertTitle>
									<AlertDescription>{usage.locked}</AlertDescription>
								</Alert>
							</SettingNote>
						) : null}
						<SettingNote>
							<UsageSendsButton onClick={() => setSends(true)} />
						</SettingNote>
					</SettingRows>
				</CardForm>
				{/* A new saved value, from here or another screen, starts a new draft. */}
				<HeadersCard
					key={JSON.stringify(data.values.telemetryHeaders)}
					settingKey="telemetryHeaders"
					saved={data.values.telemetryHeaders}
					description={
						<>
							Add the headers your tool needs, such as an API key. Write a key
							as <span className="font-mono">${"{NAME}"}</span> and save its
							value on the Secrets page.
						</>
					}
					valuePlaceholder="Bearer ${GRAFANA_TOKEN}"
				/>
			</PageSection>
			<SpaceUsageSection />
			<UsageSendsSheet open={sends} onOpenChange={setSends} />
		</>
	);
}

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
import { useId } from "react";
import type { SettingsView } from "@/shared/api";
import { PageSection } from "@/shared/page";
import { useSettingsForm, useToggleSetting } from "../hooks/use-settings-form";
import {
	CardForm,
	ResetSection,
	SaveError,
	TextSetting,
} from "./setting-fields";

const CLEANUP_KEYS = ["cleanUpAfterDays"] as const;

/** The scheduled cleanup of what ended runs left on this computer. */
export function CleanupCard({ data }: { data: SettingsView }) {
	const form = useSettingsForm(data, CLEANUP_KEYS, {
		title: "Cleanup",
		switches: ["cleanUpRuns"],
	});
	const toggle = useToggleSetting("Cleanup");
	const id = useId();

	return (
		<PageSection
			title="Cleanup"
			description="Remove what old runs leave on this computer."
			actions={<ResetSection form={form} />}
		>
			<Card>
				<CardForm form={form}>
					<CardContent>
						<FieldGroup>
							<Field orientation="horizontal">
								<FieldContent>
									<FieldLabel htmlFor={`${id}-cleanup`}>
										Clean up old runs
									</FieldLabel>
									<FieldDescription>
										Remove a run once its work is merged or pushed. Branches on
										origin stay. Remove other runs on the Branches page.
									</FieldDescription>
								</FieldContent>
								<Switch
									id={`${id}-cleanup`}
									checked={data.values.cleanUpRuns}
									disabled={toggle.isPending}
									onCheckedChange={(checked) =>
										toggle.mutate({ cleanUpRuns: checked })
									}
								/>
							</Field>
							<FieldSeparator />
							<div className="grid gap-6 sm:grid-cols-2">
								<TextSetting
									form={form}
									settingKey="cleanUpAfterDays"
									label="Clean up after"
									unit="days"
									description="Counted from the end of the run."
									inputMode="numeric"
								/>
							</div>
							<SaveError error={form.saveError} />
						</FieldGroup>
					</CardContent>
				</CardForm>
			</Card>
		</PageSection>
	);
}

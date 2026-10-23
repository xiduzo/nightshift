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
import { CardForm, FormFooter, SaveError, TextSetting } from "./setting-fields";

const CLEANUP_KEYS = ["cleanUpAfterDays"] as const;

/** The scheduled cleanup of what ended runs left on this computer. */
export function CleanupCard({ data }: { data: SettingsView }) {
	const form = useSettingsForm(data, CLEANUP_KEYS);
	const toggle = useToggleSetting();
	const id = useId();

	return (
		<PageSection
			title="Cleanup"
			description="Each run works in its own copy of the project, on its own branch. Night Shift can remove old ones for you."
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
										Night Shift removes the copy and branches of an ended run
										when its work is merged or pushed. It never deletes a branch
										on origin. Other runs stay until you remove them on the
										Branches page of their project.
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
									data={data}
									settingKey="cleanUpAfterDays"
									label="Clean up after"
									unit="days"
									description="How long after a run ends Night Shift waits before it cleans up."
									inputMode="numeric"
								/>
							</div>
							<SaveError error={form.saveError} />
						</FieldGroup>
					</CardContent>
					<FormFooter form={form} label="Save cleanup" />
				</CardForm>
			</Card>
		</PageSection>
	);
}

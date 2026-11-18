import { filledInputs, type InputTexts } from "@nightshift/client";
import {
	type FlowInputDef,
	type JsonValue,
	type Schedule,
	webhookSecretName,
} from "@nightshift/flows";
import type { WebhookForm } from "./webhook-fields";

/** The way a webhook's input value reads the webhook: `{{event.…}}`. */
export const isTemplate = (text: string) => text.includes("{{");

/**
 * A webhook schedule's values: a template stays text, to render when the
 * webhook arrives; the others are read as their type. Only the ones filled in.
 */
export function webhookInputs(
	inputs: readonly FlowInputDef[],
	values: InputTexts,
): Record<string, JsonValue> {
	const filled = filledInputs(
		inputs.filter((input) => !isTemplate(values[input.name] ?? "")),
		values,
	);
	for (const input of inputs) {
		const text = values[input.name]?.trim() ?? "";
		if (isTemplate(text)) filled[input.name] = text;
	}
	return filled;
}

export function initialWebhook(schedule: Schedule | null): WebhookForm {
	return {
		secret: webhookSecretName(schedule?.webhook?.secret ?? "") ?? "",
		when: schedule?.webhook?.when ?? "",
		signal: {
			on: schedule?.signal !== undefined,
			name: schedule?.signal?.name ?? "",
			key: schedule?.signal?.key ?? "",
		},
		scorePullRequests: schedule?.scorePullRequests === true,
	};
}

/** Why the webhook part cannot be saved, or null. */
export function webhookProblem(webhook: WebhookForm, startsFlow: boolean) {
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(webhook.secret)) {
		return "Enter the name of a secret, for example GITHUB_HOOK_SECRET.";
	}
	if (
		webhook.signal.on &&
		!/^[a-z][a-z0-9-]{0,29}$/.test(webhook.signal.name)
	) {
		return "Name the signal with lowercase letters, digits and -, for example ci-done.";
	}
	if (!startsFlow && !webhook.signal.on && !webhook.scorePullRequests) {
		return "Choose a flow, wake waiting runs, or score pull requests.";
	}
	return null;
}

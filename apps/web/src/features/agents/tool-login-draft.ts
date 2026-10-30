import type { CliTool } from "@/shared/api";
import {
	type KeyValueRow,
	newRow,
	recordFrom,
	rowsFrom,
} from "./connections/key-value-rows";

/**
 * The login fields of the CLI tool dialog: what the person types, what
 * is saved, and the usual login of the programs Night Shift knows.
 */

type Login = NonNullable<CliTool["login"]>;
type Git = NonNullable<CliTool["git"]>;

/** The login fields of the tool dialog, as the person types them. */
export type LoginDraft = {
	env: KeyValueRow[];
	ownFolder: boolean;
	folder: string;
	signInCommand: string;
	signInInput: string;
	gitHost: string;
};

export function loginDraftOf(tool: CliTool | null): LoginDraft {
	return {
		env: rowsFrom(tool?.login?.env),
		ownFolder: tool?.login?.folder !== undefined,
		folder: tool?.login?.folder ?? "HOME",
		signInCommand: tool?.login?.signIn?.command ?? "",
		signInInput: tool?.login?.signIn?.input ?? "",
		gitHost: tool?.git?.host ?? "",
	};
}

/** The login to save. Undefined: the tool has none. */
export function loginOf(draft: LoginDraft): Login | undefined {
	const env = recordFrom(draft.env);
	const folder = draft.ownFolder ? draft.folder.trim() : "";
	const command = draft.signInCommand.trim();
	if (Object.keys(env).length === 0 && folder === "") return undefined;
	return {
		env,
		...(folder ? { folder } : {}),
		...(folder && command
			? {
					signIn: {
						command,
						...(draft.signInInput.trim()
							? { input: draft.signInInput.trim() }
							: {}),
					},
				}
			: {}),
	};
}

/** The git host to save. Undefined: none. */
export function gitOf(draft: LoginDraft): Pick<Git, "host"> | undefined {
	const host = draft.gitHost.trim();
	return host ? { host } : undefined;
}

/** A variable name: what a shell reads. */
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** What is wrong with the login, for the dialog. Null: nothing. */
export function loginProblem(draft: LoginDraft): string | null {
	const bad = draft.env.find(
		(row) => row.key.trim() !== "" && !VARIABLE.test(row.key.trim()),
	);
	if (bad) {
		return `${bad.key.trim()} is not a variable name. Start with a letter or _. Use letters, digits and _.`;
	}
	if (draft.ownFolder && !VARIABLE.test(draft.folder.trim())) {
		return "Give the folder variable, for example HOME.";
	}
	return null;
}

/** A secret name for a tool: `gh-work` gives `GH_WORK_TOKEN`. */
function secretFor(tool: string, suffix = "TOKEN"): string {
	const base = tool.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
	return `${/^[A-Z_]/.test(base) ? base : `TOOL_${base}`}_${suffix}`;
}

/** The usual login of the programs Night Shift knows. */
export function loginPreset(
	program: string,
	name: string,
): Partial<LoginDraft> | null {
	const ref = (suffix?: string) => `\${${secretFor(name, suffix)}}`;
	switch (program) {
		case "gh":
			return {
				env: [newRow("GH_TOKEN", ref())],
				gitHost: "github.com",
			};
		case "glab":
			return { env: [newRow("GITLAB_TOKEN", ref())] };
		case "acli":
			return {
				ownFolder: true,
				folder: "HOME",
				signInCommand:
					"acli jira auth login --site your-site.atlassian.net --email you@example.com --token",
				signInInput: ref(),
			};
		case "aws":
			return {
				env: [
					newRow("AWS_ACCESS_KEY_ID", ref("KEY_ID")),
					newRow("AWS_SECRET_ACCESS_KEY", ref("SECRET")),
				],
			};
		case "gcloud":
			return { ownFolder: true, folder: "CLOUDSDK_CONFIG" };
		case "az":
			return { ownFolder: true, folder: "AZURE_CONFIG_DIR" };
		default:
			return null;
	}
}

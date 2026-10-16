import type { Effort, PermissionMode } from "@/lib/api-types";

/** The permission modes an Agent node or a profile can run in, most useful for nights first. */
export const PERMISSION_MODES: { value: PermissionMode; label: string }[] = [
	{ value: "auto", label: "Auto (approves safe actions, for nights)" },
	{ value: "acceptEdits", label: "Accept edits (no shell commands)" },
	{ value: "default", label: "Ask for each tool" },
	{ value: "plan", label: "Plan only" },
	{ value: "bypassPermissions", label: "Bypass permissions" },
];

export const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export function permissionLabel(mode: PermissionMode): string {
	return PERMISSION_MODES.find((m) => m.value === mode)?.label ?? mode;
}

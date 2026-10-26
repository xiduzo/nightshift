/**
 * Shell text the kits' commands share. Each command holds its own copy, so
 * a kit copied into a project reads on its own.
 */

/**
 * A shell function that prints its argument as a JSON string, for the
 * data a command writes to `$NS_OUTPUT` without `jq`: line breaks and tabs
 * become spaces, `\` and `"` are escaped.
 */
export const JSON_STRING_FUNCTION = `json() { printf '"%s"' "$(printf '%s' "$1" | tr '\\n\\r\\t' '   ' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')"; }`;

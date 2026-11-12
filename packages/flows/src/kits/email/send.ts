import type { FlowInput } from "../../flow";

/** The secrets the kit reads, by fixed names: the server, and its login. */
const SMTP_URL = "EMAIL_SMTP_URL";
const SMTP_USER = "EMAIL_SMTP_USER";
const SMTP_PASSWORD = "EMAIL_SMTP_PASSWORD";

/**
 * The command: one plain text email over SMTP with `curl`, which every
 * computer has. The secrets reach the command as environment variables and
 * curl on its standard input (`--config -`), so no secret is ever shell text
 * or an argument that another process could read. A header is one line: a
 * line break in the subject, the sender or a recipient goes, so a value
 * cannot add a header. A subject with other than ASCII is encoded
 * (RFC 2047), and the body is base64, so any text and any line length
 * arrive as they are. The server must use TLS (`--ssl-reqd`).
 */
const SEND = String.raw`# Sends one email over SMTP. The secrets reach curl on its standard input, never as arguments.
set -ef
to="{{to}}"
subject="{{subject}}"
body="{{body}}"
from="{{from}}"
[ -n "$from" ] || from="$${SMTP_USER}"
# A header is one line: a line break would start another header.
oneline() { printf '%s' "$1" | tr '\r\n' '  '; }
# The address of "Name <ada@example.com>", or the text itself, trimmed.
address() { printf '%s' "$1" | sed 's/.*<\([^>]*\)>.*/\1/; s/^[[:space:]]*//; s/[[:space:]]*$//'; }
# A value of curl's config: in quotes, with \ and " escaped.
quoted() { printf '"%s"' "$(printf '%s' "$1" | tr -d '\r\n' | sed 's/\\/\\\\/g; s/"/\\"/g')"; }
to=$(oneline "$to")
from=$(oneline "$from")
subject=$(oneline "$subject")
if printf '%s' "$subject" | LC_ALL=C grep -q '[^ -~]'; then
	subject="=?UTF-8?B?$(printf '%s' "$subject" | base64 | tr -d '\n')?="
fi
mail=$(mktemp)
trap 'rm -f "$mail"' EXIT
{
	printf 'From: %s\nTo: %s\nSubject: %s\n' "$from" "$to" "$subject"
	printf 'Date: %s\n' "$(LC_ALL=C date '+%a, %d %b %Y %H:%M:%S %z')"
	printf 'MIME-Version: 1.0\nContent-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: base64\n\n'
	printf '%s\n' "$body" | base64 | tr -d '\n' | fold -w 76
	printf '\n'
} > "$mail"
{
	printf 'url = %s\n' "$(quoted "$${SMTP_URL}")"
	[ -z "$${SMTP_USER}" ] || printf 'user = %s\n' "$(quoted "$${SMTP_USER}:$${SMTP_PASSWORD}")"
	printf 'mail-from = %s\n' "$(quoted "$(address "$from")")"
	IFS=,
	for one in $to; do
		rcpt=$(address "$one")
		[ -z "$rcpt" ] || printf 'mail-rcpt = %s\n' "$(quoted "$rcpt")"
	done
} | curl --silent --show-error --ssl-reqd --crlf --max-time 120 --upload-file "$mail" --config -`;

/**
 * `kit:email/send`: sends one plain text email over SMTP. A Command on
 * `curl`, with the server and its login in secrets of fixed names.
 */
export const emailSendKit: FlowInput = {
	version: 9,
	description: `Sends a plain text email over SMTP. Save the secrets ${SMTP_URL} (for example smtps://smtp.example.com:465), ${SMTP_USER} and ${SMTP_PASSWORD}. The server must use TLS. Needs curl.`,
	inputs: [
		{
			name: "to",
			type: "text",
			description:
				"The address to send to, for example ada@example.com. Separate more addresses with commas.",
			required: true,
		},
		{
			name: "subject",
			type: "text",
			description: "The subject, on one line.",
			required: true,
		},
		{
			name: "body",
			type: "text",
			description: "The text of the email.",
			required: true,
		},
		{
			name: "from",
			type: "text",
			description: `The sender, for example Night Shift <bot@example.com>. Empty: the user in ${SMTP_USER}.`,
			default: "",
		},
	],
	outputs: [],
	start: "send",
	nodes: [
		{
			id: "send",
			type: "command",
			label: "Send the email",
			position: { x: 0, y: 0 },
			command: SEND,
			secrets: [SMTP_URL, SMTP_USER, SMTP_PASSWORD],
			exits: [
				{ name: "sent", code: 0, color: "green" },
				{ name: "fail", color: "red" },
			],
		},
		{
			id: "sent",
			type: "end",
			position: { x: 300, y: -60 },
			status: "done",
			message: "Sent the email to {{to}}",
		},
		{
			id: "not_sent",
			type: "end",
			position: { x: 300, y: 60 },
			status: "failed",
			message: "Could not send the email to {{to}}",
		},
	],
	edges: [
		{ id: "send-sent", from: "send", outcome: "sent", to: "sent" },
		{ id: "send-fail", from: "send", outcome: "fail", to: "not_sent" },
	],
};

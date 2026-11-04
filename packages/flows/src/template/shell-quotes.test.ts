import { describe, expect, test } from "bun:test";
import { templatesInLiteralShellText as hidden } from "./shell-quotes";

describe("templatesInLiteralShellText", () => {
	test("finds a value in single quotes", () => {
		expect(hidden("lab pick --picks '{{ask.data.picks}}'  # note")).toEqual([
			"{{ask.data.picks}}",
		]);
		expect(hidden(`jq '.name == "{{item.name}}"' file`)).toEqual([
			"{{item.name}}",
		]);
	});

	test("passes a value the shell fills in", () => {
		for (const command of [
			'lab pick --picks "{{ask.data.picks}}"',
			"lab pick {{ask.data.picks}}",
			'printf \'%s\\n\' "{{a.b}}" > "$NS_OUTPUT"',
			`echo "it's {{a.b}}"`,
			"echo it\\'s {{a.b}} it\\'s",
			"# don't\necho {{a.b}} # don't",
			'"$(printf \'%s\' "{{a.b}}")"',
			"echo $# {{a.b}}",
			"cat <<< {{a.b}}",
		]) {
			expect(hidden(command)).toEqual([]);
		}
	});

	test("reads an ANSI quote up to its real end", () => {
		expect(hidden("echo $'it\\'s {{a.b}}' {{c.d}}")).toEqual(["{{a.b}}"]);
	});

	test("finds a value in a quoted heredoc only", () => {
		expect(hidden("cat <<'EOF'\n{{a.b}}\nEOF\necho {{c.d}}")).toEqual([
			"{{a.b}}",
		]);
		expect(hidden('cat <<"EOF" > f\n{{a.b}}\nEOF')).toEqual(["{{a.b}}"]);
		expect(hidden("cat <<\\EOF\n{{a.b}}\nEOF")).toEqual(["{{a.b}}"]);
		expect(hidden("cat <<-'EOF'\n\t{{a.b}}\n\tEOF\necho {{c.d}}")).toEqual([
			"{{a.b}}",
		]);
	});

	test("an unquoted heredoc fills in a value, even after an apostrophe", () => {
		expect(hidden("cat <<EOF\nit's {{a.b}}\nEOF\necho {{c.d}}")).toEqual([]);
	});
});

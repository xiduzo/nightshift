import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ChoiceField } from "./choice";
import { NumberField } from "./number-field";
import { SwitchField } from "./switch-field";

afterEach(cleanup);

const none = () => {};
const choice = { id: "c", label: "Watch", value: "a", onChange: none };
const choices = [{ value: "a", label: "A" }];
const number = { id: "n", label: "Minutes", value: 1, onChange: none };

/** The text a screen reader reads with the control. */
function described(element: Element | null): string | null | undefined {
	const id = element?.getAttribute("aria-describedby");
	return id ? document.getElementById(id)?.textContent : null;
}
const group = () =>
	described(document.querySelector("[data-slot=toggle-group]"));
const input = () => described(document.querySelector("input"));

test("a choice, a number and a switch name their hint", () => {
	render(<ChoiceField {...choice} choices={choices} hint="Pick one." />);
	expect(group()).toBe("Pick one.");
	cleanup();
	render(<NumberField {...number} hint="At most 5." />);
	expect(input()).toBe("At most 5.");
	cleanup();
	render(
		<SwitchField
			id="s"
			label="On"
			description="It runs."
			checked
			onChange={none}
		/>,
	);
	expect(described(document.querySelector("[data-slot=switch]"))).toBe(
		"It runs.",
	);
});

test("a choice and a number name their error, and nothing when they have neither", () => {
	render(<ChoiceField {...choice} choices={choices} error="Pick another." />);
	expect(group()).toBe("Pick another.");
	cleanup();
	render(<NumberField {...number} error="Too high." />);
	expect(input()).toBe("Too high.");
	cleanup();
	render(<ChoiceField {...choice} choices={choices} />);
	render(<NumberField {...number} />);
	expect(group()).toBeNull();
	expect(input()).toBeNull();
});

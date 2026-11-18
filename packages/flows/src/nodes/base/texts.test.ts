import { describe, expect, test } from "bun:test";
import { mapTexts, type NodeText, textsIn } from "./texts";

const shown = (value: unknown, texts: readonly NodeText[]) =>
	textsIn(value, texts).map((text) => `${text.at}=${text.text}`);

describe("the walk of declared texts", () => {
	test("a field, a list item and a record value, in the order they are declared", () => {
		const texts: NodeText[] = [
			{ at: "prompt" },
			{ at: "knowledge[]" },
			{ at: "inputs{}" },
		];
		const node = {
			inputs: { b: "{{one}}", a: "{{two}}" },
			knowledge: ["x", "y"],
			prompt: "p",
		};
		expect(shown(node, texts)).toEqual([
			"prompt=p",
			"knowledge[]=x",
			"knowledge[]=y",
			"inputs{}={{one}}",
			"inputs{}={{two}}",
		]);
	});

	test("a list item's texts all come before the next item's", () => {
		const texts: NodeText[] = [
			{ at: "options[].impact" },
			{ at: "options[].when", kind: "rule" },
			{ at: "cascade[].inputs{}" },
			{ at: "cascade[].situation" },
		];
		const node = {
			options: [
				{ impact: "i1", when: "w1" },
				{ impact: "i2", when: "w2" },
			],
			cascade: [{ inputs: { topic: "t1" } }, { situation: "s2" }],
		};
		expect(shown(node, texts)).toEqual([
			"options[].impact=i1",
			"options[].when=w1",
			"options[].impact=i2",
			"options[].when=w2",
			"cascade[].inputs{}=t1",
			"cascade[].situation=s2",
		]);
	});

	test("a field holds a text only where it is a string: one declaration fits each branch of a union", () => {
		const texts: NodeText[] = [
			{ at: "until.command", kind: "command" },
			{ at: "until.command.command", kind: "command" },
		];
		expect(shown({ until: { command: "a" } }, texts)).toEqual([
			"until.command=a",
		]);
		expect(shown({ until: { command: { command: "b" } } }, texts)).toEqual([
			"until.command.command=b",
		]);
		expect(shown({ until: { at: "07:00" } }, texts)).toEqual([]);
	});

	test("gives each text its kind, its own names and whether it reads the node itself", () => {
		const texts: NodeText[] = [
			{ at: "prompt" },
			{ at: "check", kind: "command" },
			{ at: "when", kind: "rule", also: ["previous"] },
			{ at: "set[].value", self: true },
		];
		const node = { prompt: "p", check: "c", when: "w", set: [{ value: "v" }] };
		expect(textsIn(node, texts)).toEqual([
			{ at: "prompt", kind: "template", also: [], self: false, text: "p" },
			{ at: "check", kind: "command", also: [], self: false, text: "c" },
			{ at: "when", kind: "rule", also: ["previous"], self: false, text: "w" },
			{ at: "set[].value", kind: "template", also: [], self: true, text: "v" },
		]);
	});

	test("mapTexts rewrites each text in place, in the same order, and keeps the rest", () => {
		const texts: NodeText[] = [
			{ at: "prompt" },
			{ at: "message" },
			{ at: "headers{}" },
			{ at: "cascade[].urgency" },
		];
		const node = {
			id: "fetch",
			headers: { Accept: "{{a}}", "X-Id": "{{b}}" },
			cascade: [{ model: "small" }, { person: true, urgency: "now" }],
			prompt: "{{c}}",
			limit: 3,
		};
		const seen: string[] = [];
		const mapped = mapTexts(node, texts, (text, field) => {
			seen.push(field.at);
			return text.toUpperCase();
		});
		expect(seen).toEqual([
			"prompt",
			"headers{}",
			"headers{}",
			"cascade[].urgency",
		]);
		expect(mapped).toEqual({
			id: "fetch",
			headers: { Accept: "{{A}}", "X-Id": "{{B}}" },
			cascade: [{ model: "small" }, { person: true, urgency: "NOW" }],
			prompt: "{{C}}",
			limit: 3,
		});
		expect(Object.keys(mapped)).toEqual(Object.keys(node));
		expect(Object.keys(mapped.headers)).toEqual(["Accept", "X-Id"]);
		expect("message" in mapped).toBe(false);
		expect(mapped.cascade[0]).toBe(node.cascade[0]);
	});

	test("a value with nothing to rewrite stays the same value", () => {
		const node = { prompt: "p", options: [{ when: "w" }], at: 3 };
		const texts: NodeText[] = [{ at: "prompt" }, { at: "options[].when" }];
		expect(mapTexts(node, texts, (text) => text)).toBe(node);
		expect(mapTexts({ prompt: 3 }, texts, () => "x")).toEqual({ prompt: 3 });
	});
});

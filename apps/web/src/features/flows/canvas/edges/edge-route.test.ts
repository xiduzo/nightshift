import { describe, expect, test } from "bun:test";
import { fitRoute, halfway, roundedPath, stemPoints } from "./edge-route";

describe("fitRoute", () => {
	test("moves the ends onto the handles and keeps every segment straight", () => {
		const route = [
			{ x: 0, y: 10 },
			{ x: 50, y: 10 },
			{ x: 50, y: 100 },
			{ x: 100, y: 100 },
		];
		expect(fitRoute(route, { x: 3, y: 14 }, { x: 98, y: 96 })).toEqual([
			{ x: 3, y: 14 },
			{ x: 50, y: 14 },
			{ x: 50, y: 96 },
			{ x: 98, y: 96 },
		]);
	});

	test("adds a jog to a straight route whose ends no longer line up", () => {
		expect(
			fitRoute(
				[
					{ x: 0, y: 0 },
					{ x: 100, y: 0 },
				],
				{ x: 0, y: 4 },
				{ x: 100, y: 0 },
			),
		).toEqual([
			{ x: 0, y: 4 },
			{ x: 50, y: 4 },
			{ x: 50, y: 0 },
			{ x: 100, y: 0 },
		]);
	});
});

describe("roundedPath", () => {
	test("rounds the corners, no more than half a short segment", () => {
		const path = roundedPath([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 100, y: 8 },
			{ x: 200, y: 8 },
		]);
		expect(path).toBe("M0,0 L96,0 Q100,0 100,4 L100,4 Q100,8 104,8 L200,8");
	});

	test("draws nothing for no points", () => {
		expect(roundedPath([])).toBe("");
	});
});

test("halfway is the middle by length", () => {
	expect(
		halfway([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 100, y: 100 },
		]),
	).toEqual({ x: 100, y: 0 });
});

test("a stem joins the route's first segment close to the node", () => {
	const route = [
		{ x: 0, y: 0 },
		{ x: 200, y: 0 },
		{ x: 200, y: 50 },
	];
	expect(stemPoints({ x: 0, y: 20 }, route)).toEqual([
		{ x: 0, y: 20 },
		{ x: 24, y: 20 },
		{ x: 24, y: 0 },
	]);
	// A first bend closer than that: join at the bend.
	expect(
		stemPoints({ x: 0, y: 20 }, [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
		]),
	).toEqual([
		{ x: 0, y: 20 },
		{ x: 10, y: 20 },
		{ x: 10, y: 0 },
	]);
});

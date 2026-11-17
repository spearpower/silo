'use client';
import { useRef, useSyncExternalStore } from 'react';

export function shallowEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const ka = Object.keys(a as object), kb = Object.keys(b as object);
	if (ka.length !== kb.length) return false;
	for (const k of ka) if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
	return true;
}

/**
 * Subscribe a component to an external store through a selector. The snapshot stays referentially stable
 * while the selected values are shallow-equal, so selectors may return small objects/arrays.
 */
export function useSelector<S, T>(subscribe: (l: () => void) => () => void, read: () => S, select: (s: S) => T): T {
	const last = useRef<{ v: T } | null>(null);
	const get = () => {
		const v = select(read());
		if (last.current && shallowEqual(last.current.v, v)) return last.current.v;
		last.current = { v };
		return v;
	};
	return useSyncExternalStore(subscribe, get, get);
}

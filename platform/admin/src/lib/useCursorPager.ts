// Cursor pagination with a back-stack, so a server cursor list gets real
// prev/next. Page N's cursor is stack[N]; advancing pushes the server's
// next_cursor, going back pops. reset() returns to the first page (call it
// whenever filters/sort change so you don't page into a stale result set).

import { useCallback, useState } from "react";

export function useCursorPager() {
    const [stack, setStack] = useState<(string | undefined)[]>([undefined]);
    const cursor = stack[stack.length - 1];

    const next = useCallback((nextCursor: string | null | undefined) => {
        if (!nextCursor) return;
        setStack((s) => [...s, nextCursor]);
    }, []);

    const prev = useCallback(() => {
        setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
    }, []);

    const reset = useCallback(() => setStack([undefined]), []);

    return { cursor, page: stack.length, canPrev: stack.length > 1, next, prev, reset };
}

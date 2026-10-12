import React from "react";
import type { AutosaveHandle } from "@/hooks/useAutosave";

// A settings tab registers its autosave state here so the settings layout can
// guard tab switches: if there are unsaved/pending/failed changes, it asks the
// user to save or discard before navigating away.
interface UnsavedEntry {
    dirty: boolean;
    save: () => Promise<void>;
    discard: () => void;
}

interface UnsavedContextValue {
    register: (id: string, entry: UnsavedEntry) => void;
    unregister: (id: string) => void;
    anyDirty: () => boolean;
    saveAll: () => Promise<void>;
    discardAll: () => void;
}

const UnsavedContext = React.createContext<UnsavedContextValue | null>(null);

export function UnsavedProvider({ children }: { children: React.ReactNode }) {
    const entries = React.useRef<Map<string, UnsavedEntry>>(new Map());

    const value = React.useMemo<UnsavedContextValue>(
        () => ({
            register: (id, entry) => entries.current.set(id, entry),
            unregister: (id) => entries.current.delete(id),
            anyDirty: () => [...entries.current.values()].some((e) => e.dirty),
            saveAll: async () => {
                await Promise.all(
                    [...entries.current.values()].filter((e) => e.dirty).map((e) => e.save()),
                );
            },
            discardAll: () => entries.current.forEach((e) => e.dirty && e.discard()),
        }),
        [],
    );

    return <UnsavedContext.Provider value={value}>{children}</UnsavedContext.Provider>;
}

export function useUnsavedRegistry() {
    return React.useContext(UnsavedContext);
}

let nextId = 0;

// Registers an autosave handle (plus how to discard its edits) with the
// settings layout. Pass the tab's useAutosave handle and a discard callback
// that resets the draft to handle.savedValue. Re-registers whenever dirty
// flips so the layout's blocker reads a current value.
export function useRegisterUnsaved<T>(handle: AutosaveHandle<T>, discard: () => void) {
    const ctx = useUnsavedRegistry();
    const idRef = React.useRef<string>("");
    if (!idRef.current) idRef.current = `unsaved-${nextId++}`;

    const ref = React.useRef({ handle, discard });
    ref.current = { handle, discard };

    React.useEffect(() => {
        if (!ctx) return;
        ctx.register(idRef.current, {
            dirty: handle.dirty,
            save: () => ref.current.handle.flush(),
            discard: () => ref.current.discard(),
        });
    }, [ctx, handle.dirty]);

    React.useEffect(() => {
        const id = idRef.current;
        return () => ctx?.unregister(id);
    }, [ctx]);
}

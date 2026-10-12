import { AnimatePresence, motion } from "framer-motion";
import { CheckIcon, Loader2Icon, AlertCircleIcon } from "lucide-react";
import type { AutosaveStatus } from "@/hooks/useAutosave";

// Header indicator for the auto-save settings tabs: Saving… / Saved / retry.
// Renders nothing when idle so the header stays quiet between edits.
export default function SaveStatus({ status, onRetry }: { status: AutosaveStatus; onRetry?: () => void }) {
    return (
        <AnimatePresence mode="wait">
            {status === "saving" && (
                <Pill key="saving" className="text-slate-500">
                    <Loader2Icon className="w-3 h-3 animate-spin" />
                    Saving…
                </Pill>
            )}
            {status === "saved" && (
                <Pill key="saved" className="text-emerald-600">
                    <CheckIcon className="w-3 h-3" />
                    Saved
                </Pill>
            )}
            {status === "error" && (
                <Pill key="error" className="text-rose-600">
                    <AlertCircleIcon className="w-3 h-3" />
                    Couldn't save
                    {onRetry && (
                        <button
                            type="button"
                            onClick={onRetry}
                            className="ml-1 underline underline-offset-2 hover:text-rose-700"
                        >
                            Retry
                        </button>
                    )}
                </Pill>
            )}
        </AnimatePresence>
    );
}

function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <motion.span
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: 0.12 }}
            className={`inline-flex items-center gap-1 text-[11.5px] font-medium ${className ?? ""}`}
        >
            {children}
        </motion.span>
    );
}

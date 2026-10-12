// DateTimePicker — the house datetime field, replacing the native
// <input type="datetime-local">. It composes the themed DatePicker + TimePicker;
// value is a local "yyyy-MM-ddTHH:mm" string (the exact shape the native input
// produced/consumed), so callers that convert local->ISO keep working unchanged.

import React from "react";

import { cn } from "@/lib/utils";
import { DatePicker } from "@/components/ui/DatePicker";
import { TimePicker } from "@/components/ui/TimePicker";

function split(v: string): { date: string; time: string } {
    if (!v) return { date: "", time: "" };
    const [d, t] = v.split("T");
    return { date: d ?? "", time: (t ?? "").slice(0, 5) };
}

function todayISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function DateTimePicker({
    value,
    onChange,
    className,
    stepMinutes = 30,
    defaultTime = "09:00",
    disabled = false,
    datePlaceholder = "Pick a date",
}: {
    /** "yyyy-MM-ddTHH:mm" (local), or "" when unset. */
    value: string;
    onChange: (value: string) => void;
    className?: string;
    stepMinutes?: number;
    defaultTime?: string;
    disabled?: boolean;
    datePlaceholder?: string;
}) {
    const { date, time } = split(value);

    const setDate = (d: string) => {
        if (!d) {
            onChange("");
            return;
        }
        onChange(`${d}T${time || defaultTime}`);
    };
    const setTime = (t: string) => {
        onChange(`${date || todayISO()}T${t}`);
    };

    return (
        <div className={cn("inline-flex items-center gap-1.5", className)}>
            <DatePicker value={date} onChange={setDate} placeholder={datePlaceholder} clearable={false} disabled={disabled} />
            <TimePicker value={time} onChange={setTime} stepMinutes={stepMinutes} disabled={disabled} placeholder="Time" />
        </div>
    );
}

export default DateTimePicker;

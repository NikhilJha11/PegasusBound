import type Inbox from "@/lib/api/models/app/emails/Inbox";
import Request from "../../Request";

export type WarmupAction = "start" | "pause" | "resume" | "stop";

// Start / pause / resume / stop warmup for a mailbox. start and resume preserve
// ramp progress server-side (a paused mailbox resumes where it left off); pause
// keeps progress; stop disables warmup and resets the ramp. Returns the updated
// mailbox.
export default async function warmupLifecycle(id: string, action: WarmupAction): Promise<Inbox> {
    return await Request<Inbox>({
        method: "POST",
        url: `/emails/${id}/warmup/${action}`,
        authorization: true,
    });
}

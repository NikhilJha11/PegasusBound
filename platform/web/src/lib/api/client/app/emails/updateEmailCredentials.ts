import Request from "../../Request";
import type Inbox from "@/lib/api/models/app/emails/Inbox";
import type Service from "@/lib/api/models/app/emails/Service";

// Replaces an SMTP/IMAP mailbox's credentials after a password change. The
// backend validates them against a live worker before storing, then
// reactivates the mailbox and clears its credential errors.
export default async function updateEmailCredentials(
    mailboxId: string,
    smtp: Service,
    imap: Service,
): Promise<Inbox> {
    return await Request<Inbox>({
        method: "PUT",
        url: `/emails/onboarding/smtp-imap/${mailboxId}`,
        data: { smtp, imap },
        authorization: true,
    });
}

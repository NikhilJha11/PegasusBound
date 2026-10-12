import { useQuery } from "@tanstack/react-query";
import getEmailTrackingDomain from "@/lib/api/client/app/emails/getEmailTrackingDomain";

// Stored tracking-domain state for a mailbox, plus the CNAME target this
// install expects. Cheap (no DNS), so unlike useAuthCheck it runs on mount:
// the card cannot render the record to add without knowing the target.
export default function useEmailTrackingDomain(id: string, enabled = true) {
    return useQuery({
        queryKey: ["emails", id, "tracking-domain"],
        queryFn: () => getEmailTrackingDomain(id),
        enabled: !!id && enabled,
        staleTime: 60_000,
    });
}

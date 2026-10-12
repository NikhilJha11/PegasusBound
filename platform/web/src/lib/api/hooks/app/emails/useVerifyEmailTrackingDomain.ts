import { useMutation, useQueryClient } from "@tanstack/react-query";
import verifyEmailTrackingDomain from "@/lib/api/client/app/emails/verifyEmailTrackingDomain";

// Re-resolves the saved tracking domain and persists the verdict. This is the
// way out of "pending" once DNS propagates, so it has to refresh the mailbox
// queries: the drawer badge and the list both read the stored state.
export default function useVerifyEmailTrackingDomain(id: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: () => verifyEmailTrackingDomain(id),
        onSuccess: (data) => {
            queryClient.setQueryData(["emails", id, "tracking-domain"], data);
            queryClient.invalidateQueries({ queryKey: ["emails"] });
        },
    });
}

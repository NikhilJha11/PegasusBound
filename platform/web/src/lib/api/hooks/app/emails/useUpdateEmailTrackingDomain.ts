import updateEmailTrackingDomain from "@/lib/api/client/app/emails/updateEmailTrackingDomain";
import type Inbox from "@/lib/api/models/app/emails/Inbox";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import patchEmailLists from "./patchEmailLists";

export default function useUpdateEmailTrackingDomain(id: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (tracking_domain: string) => updateEmailTrackingDomain(id, tracking_domain),
        onSuccess: (data) => {
            patchEmailLists(queryClient, (rows) =>
                rows.map((c) =>
                    c.id === id
                        ? {
                              ...c,
                              tracking_domain: data.tracking_domain,
                              tracking_domain_verified: data.tracking_domain_verified,
                              tracking_domain_verified_at: data.tracking_domain_verified_at,
                          }
                        : c,
                ),
            );

            // The card reads its target and diagnostic from this query.
            queryClient.setQueryData(["emails", id, "tracking-domain"], data);

            queryClient.setQueryData<Inbox>(
                ["emails", id],
                (oldData) => {
                    if (!oldData) return oldData;

                    return {
                        ...oldData,
                        tracking_domain: data.tracking_domain,
                        tracking_domain_verified: data.tracking_domain_verified,
                        tracking_domain_verified_at: data.tracking_domain_verified_at,
                    }
                }
            );
        }
    })
}

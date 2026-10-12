import { useQuery } from "@tanstack/react-query";
import getContact from "@/lib/api/client/app/contacts/getContact";

// Fetches the hydrated contact 360 payload. Keyed under the ["contacts"]
// prefix, so a contact mutation's invalidation keeps the slide-over Overview
// tab in sync after a save.
export default function useContact(id: string, enabled = true) {
    return useQuery({
        queryKey: ["contacts", id, "detail"],
        queryFn: () => getContact(id),
        enabled: enabled && !!id,
        staleTime: 30_000,
    });
}

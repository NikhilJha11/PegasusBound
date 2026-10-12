import updateContactsBulk from "@/lib/api/client/app/contacts/updateContactsBulk";
import type BulkEditContacts from "@/lib/api/models/app/contacts/BulkEditContacts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export default function useUpdateContactsBulk() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (options: BulkEditContacts) => updateContactsBulk(options),
        // Membership moves rows in and out of result sets, so the campaign Leads
        // tab (a ["contacts","list"] search scoped to one campaign) has no row to
        // patch for a contact just added to it. Refetch the whole ["contacts"]
        // prefix (lists plus the open 360), awaited so callers close on fresh
        // data (issue #187).
        onSuccess: () => {
            return Promise.all([
                queryClient.invalidateQueries({ queryKey: ["contacts"] }),
                queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
            ]);
        },
    });
}

import updateContact from "@/lib/api/client/app/contacts/updateContact";
import type ContactUpdate from "@/lib/api/models/app/contacts/ContactUpdate";
import type SearchContactsResult from "@/lib/api/models/app/contacts/SearchContactsResult";
import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";

export default function useUpdateContact(id: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (contact: Partial<ContactUpdate>) => updateContact(id, contact),
        onSuccess: (data) => {
            const allLists = queryClient.getQueriesData<InfiniteData<SearchContactsResult>>({
                queryKey: ["contacts", "list"],
            });

            for (const [key, oldData] of allLists) {
                if (!oldData) continue;

                queryClient.setQueryData(key, {
                    ...oldData,
                    pages: oldData.pages.map((page) => ({
                        ...page,
                        data: page.data.map((c) => c.id === id ? data : c),
                    })),
                });
            }

            // Patching rewrites rows a list already holds; campaign membership
            // decides which lists hold the contact at all (the Leads tab is this
            // search scoped to one campaign), so they must refetch (issue #187).
            return Promise.all([
                queryClient.invalidateQueries({ queryKey: ["contacts"] }),
                queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
            ]);
        }
    })
}

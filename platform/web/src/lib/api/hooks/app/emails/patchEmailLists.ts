import type GetEmails from "@/lib/api/models/app/emails/GetEmails";
import type Inbox from "@/lib/api/models/app/emails/Inbox";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";

type EmailListCache = InfiniteData<GetEmails> | Inbox[];

// ["emails", "list"] holds both the paginated list (InfiniteData) and the flat directory (Inbox[]); patch each by shape.
export default function patchEmailLists(queryClient: QueryClient, patch: (rows: Inbox[]) => Inbox[]) {
    const allLists = queryClient.getQueriesData<EmailListCache>({ queryKey: ["emails", "list"] });

    for (const [key, oldData] of allLists) {
        if (!oldData) continue;

        if (Array.isArray(oldData)) {
            queryClient.setQueryData(key, patch(oldData));
            continue;
        }

        if (!Array.isArray(oldData.pages)) continue;

        queryClient.setQueryData(key, {
            ...oldData,
            pages: oldData.pages.map((page) => ({
                ...page,
                data: patch(page.data ?? []),
            })),
        });
    }
}

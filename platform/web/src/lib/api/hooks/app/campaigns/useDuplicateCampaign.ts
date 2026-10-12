import duplicateCampaign from "@/lib/api/client/app/campaigns/duplicateCampaign";
import type Campaign from "@/lib/api/models/app/campaigns/Campaign";
import type GetCampaigns from "@/lib/api/models/app/campaigns/GetCampaigns";
import { type InfiniteData, useMutation, useQueryClient } from "@tanstack/react-query";

// Duplicates a campaign into a new draft. The copy is placed at the top of
// the cached unfiltered lists immediately (it is the newest campaign; a
// search- or folder-filtered list may not contain it, so those only refetch),
// the detail entry is primed so navigating to it does not flash a skeleton,
// and every list is refetched to settle ordering.
export default function useDuplicateCampaign() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, name }: { id: string; name?: string }) => duplicateCampaign(id, name),
        onSuccess: (campaign: Campaign) => {
            const allLists = queryClient.getQueriesData<InfiniteData<GetCampaigns>>({
                queryKey: ["campaigns", "list"],
            });
            for (const [key, oldData] of allLists) {
                const [, , query, folder] = key as [string, string, string, string, number];
                if (query || folder) continue;
                if (!oldData || oldData.pages.length === 0) continue;
                queryClient.setQueryData(key, {
                    ...oldData,
                    pages: oldData.pages.map((page, i) =>
                        i === 0
                            ? { ...page, data: [campaign, ...page.data.filter((c) => c.id !== campaign.id)] }
                            : page,
                    ),
                });
            }
            queryClient.setQueryData(["campaigns", campaign.id], campaign);
            queryClient.invalidateQueries({ queryKey: ["campaigns", "list"] });
        },
    });
}

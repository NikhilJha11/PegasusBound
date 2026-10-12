import createCampaign, {
    type CreateCampaignInput,
} from "@/lib/api/client/app/campaigns/createCampaign";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export default function useCreateCampaign() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (input: CreateCampaignInput) => createCampaign(input),
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: ["campaigns", "list"],
            });
        },
    });
}

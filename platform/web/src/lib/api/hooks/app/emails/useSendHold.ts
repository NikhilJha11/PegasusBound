import sendHold from "@/lib/api/client/app/emails/sendHold";
import { useMutation, useQueryClient } from "@tanstack/react-query";

// The lifecycle is read off the account-status query, so that is what refreshes.
export default function useSendHold(id: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (hold: boolean) => sendHold(id, hold),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["analytics", "accounts", id] });
        },
    });
}

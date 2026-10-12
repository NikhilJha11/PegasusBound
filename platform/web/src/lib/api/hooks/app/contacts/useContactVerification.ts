import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    getContactVerification,
    requestContactVerification,
    type VerificationRequest,
} from "@/lib/api/client/app/contacts/verification";

export function useContactVerification(enabled = true) {
    return useQuery({
        queryKey: ["contacts", "verification"],
        queryFn: getContactVerification,
        staleTime: 60 * 1000,
        enabled,
    });
}

export function useRequestContactVerification() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (req: VerificationRequest) => requestContactVerification(req),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["contacts"] });
            queryClient.invalidateQueries({ queryKey: ["campaigns"] });
        },
    });
}

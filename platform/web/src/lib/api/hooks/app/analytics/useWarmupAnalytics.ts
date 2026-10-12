import { useQuery } from "@tanstack/react-query";
import getWarmup from "@/lib/api/client/app/analytics/getWarmup";

export default function useWarmupAnalytics(emailId?: string, from?: string, to?: string) {
    return useQuery({
        queryKey: ["analytics", "warmup", emailId ?? "all", from ?? "", to ?? ""],
        queryFn: () => getWarmup(emailId, from, to),
        enabled: !!emailId,
    })
}

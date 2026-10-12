import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    getWebsiteTrackingSettings,
    rotateWebsiteTrackingKey,
    updateWebsiteTrackingSettings,
} from "@/lib/api/client/app/websitetracking/websiteTracking";
import type { UpdateWebsiteTrackingSettings } from "@/lib/api/models/app/websitetracking/WebsiteTrackingSettings";

export const WEBSITE_TRACKING_KEY = ["website-tracking", "settings"];

export function useWebsiteTrackingSettings() {
    return useQuery({
        queryKey: WEBSITE_TRACKING_KEY,
        queryFn: getWebsiteTrackingSettings,
    });
}

export function useUpdateWebsiteTrackingSettings() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (patch: UpdateWebsiteTrackingSettings) => updateWebsiteTrackingSettings(patch),
        onSuccess: (settings) => {
            qc.setQueryData(WEBSITE_TRACKING_KEY, settings);
        },
    });
}

export function useRotateWebsiteTrackingKey() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: rotateWebsiteTrackingKey,
        onSuccess: (settings) => {
            qc.setQueryData(WEBSITE_TRACKING_KEY, settings);
        },
    });
}

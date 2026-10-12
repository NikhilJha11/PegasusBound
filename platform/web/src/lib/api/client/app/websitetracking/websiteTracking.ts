import type {
    UpdateWebsiteTrackingSettings,
    WebsiteTrackingSettings,
} from "@/lib/api/models/app/websitetracking/WebsiteTrackingSettings";
import Request from "../../Request";

export async function getWebsiteTrackingSettings(): Promise<WebsiteTrackingSettings> {
    return await Request<WebsiteTrackingSettings>({
        method: "GET",
        url: "/website-tracking/settings",
        authorization: true,
    });
}

export async function updateWebsiteTrackingSettings(
    patch: UpdateWebsiteTrackingSettings,
): Promise<WebsiteTrackingSettings> {
    return await Request<WebsiteTrackingSettings>({
        method: "PATCH",
        url: "/website-tracking/settings",
        data: patch,
        authorization: true,
    });
}

export async function rotateWebsiteTrackingKey(): Promise<WebsiteTrackingSettings> {
    return await Request<WebsiteTrackingSettings>({
        method: "POST",
        url: "/website-tracking/settings/rotate-key",
        authorization: true,
    });
}

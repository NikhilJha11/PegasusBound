import type Plan from "@/lib/api/models/app/subscription/Plan";
import Request from "../../Request";

export default async function listPlans(): Promise<Plan[]> {
    // The API wraps the list as { plans: [...] }; tolerate a bare array too.
    const res = await Request<{ plans: Plan[] } | Plan[]>({
        method: "GET",
        url: `/plans`,
        authorization: true,
    })
    return Array.isArray(res) ? res : (res?.plans ?? [])
}

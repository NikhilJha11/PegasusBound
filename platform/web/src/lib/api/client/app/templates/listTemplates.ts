import type Template from "@/lib/api/models/app/templates/Template";
import type { TemplatesResult } from "@/lib/api/models/app/templates/Template";
import Request from "../../Request";

export default async function listTemplates(search?: string): Promise<Template[]> {
    const url = search && search.trim()
        ? `/templates?q=${encodeURIComponent(search.trim())}`
        : `/templates`;
    const res = await Request<TemplatesResult>({
        method: "GET",
        url,
        authorization: true,
    });
    return res.data ?? [];
}

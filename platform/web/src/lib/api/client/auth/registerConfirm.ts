import type RegisterConfirm from "@/lib/api/models/auth/RegisterConfirm";
import type Session from "@/lib/api/models/auth/Session";
import Request from "../Request";

export default async function registerConfirm(data: RegisterConfirm): Promise<Session> {
    return await Request<Session>({
        method: "POST",
        url: "/auth/register/confirm",
        data,
    })
}

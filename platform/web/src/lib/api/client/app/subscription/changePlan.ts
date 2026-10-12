import Request from "../../Request";

export interface ChangePlanInput {
    plan_id: string;
    // Optional discount/promo code applied to the plan change.
    discount_code?: string;
    // Billing interval to switch to. Defaults to monthly server-side when omitted.
    interval?: "month" | "year";
}

export default async function changePlan(data: ChangePlanInput): Promise<void> {
    return await Request<void>({
        method: "POST",
        url: `/subscription/change-plan`,
        data,
        authorization: true,
    });
}

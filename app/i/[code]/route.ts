import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { normalizeInfluencerCode } from "@/lib/influencers/code";

export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  const normalized = normalizeInfluencerCode(code);

  const response = NextResponse.redirect(new URL("/", request.url), {
    status: 307,
  });

  if (normalized) {
    const settings = await getSettings();
    const days = Math.max(1, Math.min(90, settings.influencerCookieDays || 30));
    response.cookies.set("habitt_inf", normalized, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: days * 24 * 60 * 60,
    });
  }

  return response;
}

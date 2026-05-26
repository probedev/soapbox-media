"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, adminToken } from "@/lib/adminAuth";

export async function login(formData: FormData) {
  const pw = String(formData.get("password") || "");
  const ok = pw.length > 0 && pw === process.env.ADMIN_PASSWORD;

  if (!ok) {
    redirect("/admin/login?error=1");
  }

  const token = await adminToken();
  if (token) {
    cookies().set(ADMIN_COOKIE, token, {
      httpOnly: true,
      // Allow http on localhost for dev; require https in production.
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
  }
  redirect("/admin");
}

export async function logout() {
  cookies().delete(ADMIN_COOKIE);
  redirect("/admin/login");
}

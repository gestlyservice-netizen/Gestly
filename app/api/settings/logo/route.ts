import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

    const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Upload non configuré : NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis" },
        { status: 503 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) return NextResponse.json({ error: "Aucun fichier fourni" }, { status: 400 });

    const allowed = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
    if (!allowed.includes(file.type)) {
      return NextResponse.json({ error: "Format non supporté (jpg, png, webp, svg)" }, { status: 400 });
    }
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: "Fichier trop volumineux (max 2 Mo)" }, { status: 400 });
    }

    const ext      = file.name.split(".").pop() ?? "png";
    const filename = `logos/${user.id}.${ext}`;
    const buffer   = await file.arrayBuffer();

    const res = await fetch(
      `${supabaseUrl}/storage/v1/object/documents/${filename}`,
      {
        method:  "POST",
        headers: {
          Authorization:   `Bearer ${serviceRoleKey}`,
          "Content-Type":  file.type,
          "x-upsert":      "true",
        },
        body: buffer,
      }
    );

    if (!res.ok) {
      const text = await res.text();
      console.error("[POST /api/settings/logo] Supabase error:", text);
      return NextResponse.json({ error: "Échec de l'upload" }, { status: 500 });
    }

    const publicUrl = `${supabaseUrl}/storage/v1/object/public/documents/${filename}`;
    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    console.error("[POST /api/settings/logo]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    const clients = await prisma.client.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(clients);
  } catch (err) {
    console.error("[GET /api/clients]", err);
    return NextResponse.json(
      { error: "Erreur serveur lors de la récupération des clients" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Corps de la requête invalide (JSON attendu)" },
        { status: 400 }
      );
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Payload invalide" }, { status: 400 });
    }

    const { name, email, phone, address } = body as Record<string, unknown>;

    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: "Le nom est obligatoire" },
        { status: 400 }
      );
    }

    const data = {
      userId: user.id,
      name: name.trim(),
      email: typeof email === "string" && email.trim() ? email.trim() : null,
      phone: typeof phone === "string" && phone.trim() ? phone.trim() : null,
      address:
        typeof address === "string" && address.trim() ? address.trim() : null,
    };

    console.info("[POST /api/clients] Creating client for user", user.id, {
      name: data.name,
    });

    const client = await prisma.client.create({ data });

    return NextResponse.json(client, { status: 201 });
  } catch (err) {
    console.error("[POST /api/clients]", err);
    return NextResponse.json(
      { error: "Erreur serveur lors de la création du client" },
      { status: 500 }
    );
  }
}

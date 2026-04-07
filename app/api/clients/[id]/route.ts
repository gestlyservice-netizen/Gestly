import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function getClientForUser(id: string, userId: string) {
  return prisma.client.findFirst({ where: { id, userId } });
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    const existing = await getClientForUser(params.id, user.id);
    if (!existing) {
      return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
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

    const client = await prisma.client.update({
      where: { id: params.id },
      data: {
        name: name.trim(),
        email: typeof email === "string" && email.trim() ? email.trim() : null,
        phone: typeof phone === "string" && phone.trim() ? phone.trim() : null,
        address:
          typeof address === "string" && address.trim()
            ? address.trim()
            : null,
      },
    });

    return NextResponse.json(client);
  } catch (err) {
    console.error("[PUT /api/clients/:id]", err);
    return NextResponse.json(
      { error: "Erreur serveur lors de la mise à jour du client" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    const existing = await getClientForUser(params.id, user.id);
    if (!existing) {
      return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
    }

    await prisma.client.delete({ where: { id: params.id } });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/clients/:id]", err);
    return NextResponse.json(
      { error: "Erreur serveur lors de la suppression du client" },
      { status: 500 }
    );
  }
}

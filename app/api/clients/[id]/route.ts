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
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const existing = await getClientForUser(params.id, user.id);
  if (!existing) {
    return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
  }

  const body = await request.json();
  const { name, email, phone, address } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Le nom est obligatoire" }, { status: 400 });
  }

  const client = await prisma.client.update({
    where: { id: params.id },
    data: {
      name: name.trim(),
      email: email?.trim() || null,
      phone: phone?.trim() || null,
      address: address?.trim() || null,
    },
  });

  return NextResponse.json(client);
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
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
}

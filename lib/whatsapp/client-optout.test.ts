import { describe, it, expect, vi, beforeEach } from "vitest";

const findManyMock = vi.fn();
const updateMock = vi.fn();
const escalateToArtisanMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    client: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
  },
}));

vi.mock("@/lib/whatsapp/escalation", () => ({
  escalateToArtisan: (...args: unknown[]) => escalateToArtisanMock(...args),
}));

import { resolveClientStop, handleClientStopFromUnknownSender } from "@/lib/whatsapp/client-optout";

beforeEach(() => {
  findManyMock.mockReset();
  updateMock.mockReset();
  escalateToArtisanMock.mockReset();
});

function client(id: string, userId: string, phone: string) {
  return { id, userId, phone, name: `Client ${id}` };
}

describe("resolveClientStop", () => {
  it("no_match si aucun Client ne correspond au numéro", async () => {
    findManyMock.mockResolvedValue([]);
    const res = await resolveClientStop("+33612345678");
    expect(res.kind).toBe("no_match");
  });

  // Test requis #6 : résolution non ambiguë -> un seul Client concerné.
  it("unique_client si le numéro correspond à un seul Client chez un seul artisan", async () => {
    findManyMock.mockResolvedValue([client("c1", "artisan_A", "+33612345678")]);
    const res = await resolveClientStop("0612345678");
    expect(res).toEqual({ kind: "unique_client", clientId: "c1", userId: "artisan_A" });
  });

  it("same_tenant_ambiguous si plusieurs fiches Client du MÊME artisan correspondent", async () => {
    findManyMock.mockResolvedValue([
      client("c1", "artisan_A", "+33612345678"),
      client("c2", "artisan_A", "+33612345678"),
    ]);
    const res = await resolveClientStop("0612345678");
    expect(res).toEqual({
      kind: "same_tenant_ambiguous",
      userId: "artisan_A",
      candidateIds: ["c1", "c2"],
    });
  });

  // Test requis #7 : ambiguïté inter-sociétés -> aucune décision automatique.
  it("cross_tenant_ambiguous si des Client d'artisans DIFFÉRENTS partagent ce numéro", async () => {
    findManyMock.mockResolvedValue([
      client("c1", "artisan_A", "+33612345678"),
      client("c2", "artisan_B", "+33612345678"),
    ]);
    const res = await resolveClientStop("0612345678");
    expect(res).toEqual({ kind: "cross_tenant_ambiguous", candidateCount: 2 });
  });
});

describe("handleClientStopFromUnknownSender", () => {
  it("applique l'opt-out uniquement sur la fiche Client résolue sans ambiguïté", async () => {
    findManyMock.mockResolvedValue([client("c1", "artisan_A", "+33612345678")]);
    await handleClientStopFromUnknownSender("0612345678");
    expect(updateMock).toHaveBeenCalledWith({ where: { id: "c1" }, data: { whatsappOptOut: true } });
    expect(escalateToArtisanMock).not.toHaveBeenCalled();
  });

  it("ne modifie AUCUNE fiche en cas d'ambiguïté inter-sociétés, et n'escalade jamais (pas de fuite ciblée)", async () => {
    findManyMock.mockResolvedValue([
      client("c1", "artisan_A", "+33612345678"),
      client("c2", "artisan_B", "+33612345678"),
    ]);
    await handleClientStopFromUnknownSender("0612345678");
    expect(updateMock).not.toHaveBeenCalled();
    expect(escalateToArtisanMock).not.toHaveBeenCalled();
  });

  it("ne modifie aucune fiche en cas d'ambiguïté interne à un même artisan, mais l'en informe", async () => {
    findManyMock.mockResolvedValue([
      client("c1", "artisan_A", "+33612345678"),
      client("c2", "artisan_A", "+33612345678"),
    ]);
    await handleClientStopFromUnknownSender("0612345678");
    expect(updateMock).not.toHaveBeenCalled();
    expect(escalateToArtisanMock).toHaveBeenCalledWith(
      "artisan_A",
      "client_ambigu_stop",
      "0612345678",
      expect.any(String)
    );
  });

  it("ne fait rien pour un numéro totalement inconnu", async () => {
    findManyMock.mockResolvedValue([]);
    await handleClientStopFromUnknownSender("0699999999");
    expect(updateMock).not.toHaveBeenCalled();
    expect(escalateToArtisanMock).not.toHaveBeenCalled();
  });
});

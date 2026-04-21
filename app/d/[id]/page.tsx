import { redirect } from "next/navigation";

export default async function ShortDevisLink({ params }: { params: { id: string } }) {
  redirect(`/print/devis/${params.id}`);
}

import { redirect } from "next/navigation";

export const metadata = { title: "Ingresar" };

/** El ingreso vive en `/cuenta`, con la cuenta y los datos: esta ruta queda para los enlaces viejos. */
export const dynamic = "force-dynamic";

export default function IngresarPage() {
  redirect("/cuenta");
}

import { SettingsEditor } from "./SettingsEditor";

export const metadata = { title: "Mis keys" };

// Dinámico a propósito, como toda página de `(app)`: el pie legal del layout
// lee la identidad del operador del entorno en cada request y no se hornea en
// el bundle estático (ver `app/page.tsx`).
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return <SettingsEditor />;
}

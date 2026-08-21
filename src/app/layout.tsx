import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ENPLAS · Etiquetado",
  description: "Trazabilidad de cajas en planta",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // La estación es una pantalla táctil: que no haga zoom por un doble toque.
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}

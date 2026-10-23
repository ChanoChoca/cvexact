# La plantilla del CV

Este documento es la fuente de verdad del diseño del CV. `components/cv/cv-document.css`
lo implementa para la pantalla y el PDF, y `lib/docx/cv-docx.ts` lo traduce a OOXML.
`public/plantilla-cv.html` es el espécimen de referencia: el mismo diseño en un HTML
autocontenido, con contenido ficticio, para compararlo a ojo contra `/cv/demo/print`.

Todo lo que hay acá son medidas y decisiones de formato, no expresión de terceros: el
contenido del espécimen es inventado y las fuentes son libres (ver `THIRD_PARTY.md`).

## Página

- A4: 595,28 × 841,89 pt. Márgenes: 28,4 pt arriba y a los lados, 14,2 pt abajo.
- Ancho de contenido: 538,48 pt. Impresión con `@page { size: A4; margin: 0 }`.
- Sin partición de palabras (`hyphens: none`) y con corte de tokens largos
  (`overflow-wrap: anywhere`): un email o una URL no puede salirse de la hoja.
- Sin ligaduras (`font-variant-ligatures: none`), para que la capa de texto del PDF
  conserve cada letra.

## Tipografía

- STIX Two Text, auto-hospedada en `public/fonts/` (SIL OFL 1.1). Pesos 400 y 700,
  recta y cursiva. Sin familia de relleno propietaria: el respaldo es `serif`.
- Cuerpo 11 pt, interlineado 1. Nombre 24 pt en negrita y centrado. Resumen 10,5 pt en
  cursiva, color `#0e0e0e`, interlineado 1,15. Títulos de sección 12 pt en negrita.
  Fechas en cursiva, interlineado 1,5.
- Enlaces `#1155cc`, subrayados, sin `text-decoration-skip-ink`.

## Cabecera

- Nombre centrado.
- Línea de contacto centrada: ubicación • teléfono • email, con 9 pt arriba y abajo y
  una regla inferior de 1 pt. Si hay enlaces, van en una segunda línea con 2 pt de
  separación.

## Resumen y secciones

- 7,1 pt entre la regla del contacto y el resumen.
- Cada sección empieza 12 pt después de lo anterior.
- Título de sección: 2 pt de relleno inferior y regla de 1 pt; 9 pt hasta el primer
  contenido.
- Entradas: 12 pt entre una y otra; encabezado en dos columnas (flex, 12 pt de
  separación), la derecha con un máximo del 45 % y alineada a la derecha, para que una
  fecha o una ciudad largas cedan antes que el nombre de la empresa.
- Empresa e institución en negrita; cargo y grado en redonda; ubicación en negrita;
  fechas en cursiva.

## Viñetas

- 4 pt desde el encabezado de la entrada.
- Sangría de 32,2 pt; marcador `•` en una caja de 17,9 pt que cuelga hacia afuera
  (margen negativo de 17,9 pt); 3 pt después de cada viñeta; interlineado 1.
- Las secciones de viñetas sueltas (skills, actividades) usan interlineado 1,0791666.

## Estructura del contenido

- Secciones: experiencia, educación, proyectos, skills, actividades, pares
  (certificaciones, idiomas, disponibilidad).
- Experiencia: empresa, cargo, ubicación, fechas y hasta cinco viñetas en el puesto más
  reciente; los puestos más viejos llevan menos.
- Educación: institución, grado, ubicación, fecha y una línea de honores.
- El contenido del espécimen mantiene el número de viñetas y largos parecidos a los de
  cualquier CV real, porque de eso depende que la comprobación de fidelidad mida algo.

/**
 * CVs as text, in the shapes CVs come in. Each one is a layout a real person
 * uses; together they are what the heuristic parser is measured against. The
 * people are made up.
 */

/** Spanish, bullets, "Empresa | Puesto | fechas", the most common layout. */
export const SPANISH_BULLETS = `LUCÍA FERNÁNDEZ
Analista de Marketing Digital
Valencia, España | +34 611 22 33 44 | lucia.fernandez@example.com
linkedin.com/in/perfil-ejemplo

PERFIL
Analista con seis años de experiencia en campañas de pago y SEO.

EXPERIENCIA LABORAL

Nubia Retail | Analista de Marketing Digital | marzo 2021 – actualidad
• Llevo las campañas de Google Ads y Meta para tres marcas.
• Preparo los informes mensuales para dirección.
• Coordino a la agencia que nos hace el contenido.

Grupo Lumen | Asistente de Marketing | septiembre 2018 – febrero 2021
• Gestioné el calendario de contenidos en redes sociales.
• Armé los newsletters semanales.

FORMACIÓN
Grado en Administración y Dirección de Empresas
Universidad de Valencia
2013 - 2017

IDIOMAS
Español: Nativo
Inglés: B2

HABILIDADES
Google Analytics, SEO, HubSpot, Email marketing, Copywriting

CURSOS Y CERTIFICACIONES
Google Ads Certification — Google (2022)
Curso de HubSpot Inbound, 2020
`;

/** English, "Title, Company" then dates on their own line. */
export const ENGLISH_STACKED = `John Carter
Senior Software Engineer
Austin, USA · +1 512 555 0142 · john.carter@example.com
github.com/perfil-ejemplo

SUMMARY
Backend engineer focused on payments and data pipelines.

WORK EXPERIENCE

Senior Software Engineer
Globex Corporation
Jan 2020 - Present
- Lead the payments platform team of six engineers.
- Cut settlement time from two days to four hours.

Software Engineer
Initech Labs
June 2016 - December 2019
- Built the ingestion service in Go and Kafka.

EDUCATION
B.Sc. in Computer Science
University of Texas at Austin
2012 - 2016

SKILLS
Go, Kafka, PostgreSQL, Kubernetes, AWS

LANGUAGES
English (Native), Spanish (Fluent)
`;

/** Dates first, names under them. */
export const DATES_FIRST = `Martín Ríos
mrios@example.com  |  +54 9 341 555 0199  |  Rosario, Argentina

EXPERIENCIA
2019 - 2023
Cajero — Supermercados Delta
Atención al público y cierre de caja diario.
Reposición de góndolas.

2016 - 2019
Repositor — Almacén Central
Recepción de mercadería.

ESTUDIOS
Secundario completo - Escuela Técnica N° 5 - 2015
`;

/** Role and company both look like companies; the parser must not pretend to know. */
export const AMBIGUOUS = `Paula Gómez

EXPERIENCIA LABORAL
Estrella Norte
Mercado Sur
2020 - 2022
Trabajé en atención.
`;

/** Personal data that must not be read into the profile. */
export const WITH_PERSONAL_DATA = `Carlos Méndez
Fecha de nacimiento: 12/05/1990
DNI: 30.123.456
Estado civil: Soltero
Dirección: Av. Corrientes 1234, CABA
carlos@example.com | +54 11 4555 0100

EXPERIENCIA
Banco Galicia
Ejecutivo de cuentas
2018 - 2022
Atención de cartera de 120 clientes.

REFERENCIAS
María Pérez - +54 11 5555 0000
`;

/** Studies with no dates at all. */
export const UNDATED_EDUCATION = `Sofía Rey

EXPERIENCIA
Estudio Jurídico Rey | Abogada | 2015 - 2020
Patrocinio de causas civiles.

FORMACIÓN
Abogacía - Universidad de Buenos Aires
Diplomatura en Derecho Laboral
Universidad Austral
`;

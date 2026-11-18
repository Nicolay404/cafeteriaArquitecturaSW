# Dirección visual de las pantallas de cuenta — PROPUESTA (pendiente de aprobación del equipo)

2026-11-18 · Spec #2 · tarea T009. Es una propuesta para que el equipo la apruebe o la cambie (AGENTS.md: dirección visual, fotos y textos finales requieren su aprobación). Hasta entonces las pantallas usan estos tokens como base funcional y nada se da por definitivo.

## De dónde sale

Las dos referencias que compartió el equipo («CAFÉ — Coffee & More» y «The Coffee Lounge») son **solo inspiración**. De ellas se toma el carácter, no el contenido: fondo crema cálido, acentos café oscuro, titulares con serifa, botones redondeados y mucho aire. No se copian textos, logos, fotos ni composiciones, no se genera ninguna imagen con IA y no se inventan datos del negocio (nombre, dirección, horarios, precios).

La skill `design-taste-frontend` está pensada para páginas de marketing (hero, fotografías, momentos animados). Las pantallas de cuenta son formularios utilitarios, así que se aplican de ella solo sus principios: una paleta pensada para el oficio (cafetería), fondos planos sin efectos, **una** acción principal por pantalla, una sola familia de botones y tarjetas, respuesta visible al puntero y copy sin relleno. Su canalización completa (hero, fotos, momentos, puerta de calidad) se usará para la página de inicio, que no es parte de este spec.

## Paleta (contrastes medidos)

Cálculo de contraste WCAG 2.2 sobre los valores reales. Objetivo AAA: texto ≥ 7:1; bordes y anillos de foco ≥ 3:1 (aquí se superan).

| Token | Valor | Uso | Sobre | Contraste |
|---|---|---|---|---|
| `--crema` | `#F6EFE4` | fondo de página | — | — |
| `--tinte` | `#EADFCF` | franjas y paneles | — | — |
| `--superficie` | `#FFFFFF` | tarjetas y campos | — | — |
| `--tinta` | `#2A1B12` | texto principal | crema / blanco / tinte | 14,55 / 16,61 / 12,62 |
| `--tinta-suave` | `#52392A` | texto secundario y ayudas | crema / tinte | 9,30 / 8,07 |
| `--cafe` | `#5A331A` | botón principal (texto blanco) | blanco sobre café | 10,92 |
| `--cafe-oscuro` | `#40240F` | botón al pasar el puntero | blanco sobre café oscuro | 14,22 |
| `--enlace` | `#6A3512` | enlaces | crema / blanco | 8,63 / 9,86 |
| `--error` | `#8B1A1A` | errores (con icono y texto, nunca solo color) | crema / blanco | 8,13 / 9,29 |
| `--exito` | `#164E26` | confirmaciones | crema / tinte / blanco | 8,54 / 7,41 / 9,76 |
| `--foco` | `#1F1F1F` | anillo de foco de 3 px | crema | 14,43 |
| `--borde` | `#7A5C47` | borde de campos | blanco / crema | 6,09 / 5,33 |

El marrón claro de los botones de las referencias no llega a 7:1 con texto blanco, por eso se oscurece. Sin violeta. Sin degradados ni fondos con efectos: colores planos.

## Tipografía

- Titulares: serifa del sistema (`"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`), que da el aire de las referencias sin descargar nada.
- Texto y formularios: sans del sistema (`system-ui, -apple-system, "Segoe UI", sans-serif`), 18 px base (≥ 16 px; más cómodo para AAA), interlineado 1,6, líneas de 45–75 caracteres.
- **Sin Google Fonts ni CDNs**: cargar fuentes de terceros enviaría la IP de cada visitante a otro servicio (LOPDP). Si el equipo quiere una serifa concreta, se autoaloja (woff2 propio, con licencia) y se cambia el token `--serifa`.

## Forma y componentes

- Radio suave de 12 px en campos y tarjetas; botones en píldora (999 px), como en las referencias.
- Campos de 48 px de alto mínimo (objetivo táctil ≥ 44 px), borde de 2 px, etiqueta **visible** encima, ayuda debajo y error propio bajo el campo.
- Un solo botón principal por pantalla (café relleno); el secundario es de contorno. Enlaces subrayados siempre.
- Errores: icono más texto «Error: …» con `aria-describedby`; al enviar, un **resumen** de errores arriba que recibe el foco y enlaza a cada campo.
- Confirmaciones en una región `role="status"` (no desaparecen solas: sin límites de tiempo).
- Mostrar/ocultar contraseña como botón con estado (`aria-pressed`), sin esconder lo escrito por defecto de forma que impida corregir.

## Movimiento

Mínimo y siempre reducible: los botones suben 1 px y oscurecen al pasar el puntero, y se hunden al pulsar; los enlaces dibujan el subrayado. Nada se anima al hacer scroll. Con `prefers-reduced-motion: reduce` todo queda quieto (ya garantizado en `bootstrap.css`).

## Estructura de pantalla

Móvil primero, una columna de 32 rem como máximo centrada en la crema; encabezado con el nombre del sitio (pendiente: logo y nombre definitivos del equipo), título serif, una frase que dice qué pasa en esa pantalla, el formulario y, debajo, el enlace alternativo («¿Ya tienes cuenta? Inicia sesión»). Sin fotografías en estas pantallas: no aportan a un formulario.

## Lo que necesita aprobación del equipo

1. La paleta y la tipografía de arriba (o la alternativa que prefieran).
2. El nombre y el logo del sitio que aparecen en el encabezado (hoy un texto provisional «Cafetería»).
3. Los textos finales: los de las pantallas son borradores claros, sin marca ni promesas.
4. Si desean fotografías o ilustraciones en la página de inicio (fuera de este spec): han de ser propias o con licencia, nunca generadas con IA.

Estado: **sin aprobar**. Se registrará aquí la decisión del equipo (T045).

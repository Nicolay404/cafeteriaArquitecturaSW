# Evidencia T024 — rendimiento del motor de precios

**Fecha**: 2026-11-18 · **Rama**: `feature/spec-5` · **Alcance**: solo el motor puro (`calcularCotizacion`), sin red, base de datos ni caché.

## Entorno

- Intel Core Ultra 9 275HX, Windows 11, Node 24.22.1, un solo hilo.
- Carrito máximo del spec 004: 10 productos × 5 unidades = **50 unidades**.
- Promociones sintéticas de los cuatro tipos (porcentaje, monto fijo, 3x2 y combo), **todas sobre las 50 unidades** y todas acumulables, que es lo más caro para el algoritmo (`dominio/escenarios-carga.ts`).
- 20 ejecuciones de calentamiento y 200 medidas por escenario con `performance.now()`.

## Resultados

| Escenario | p50 | p95 | Máx. | Promociones aplicadas |
|---|---|---|---|---|
| 20 promociones, misma prioridad | 0,31 ms | 0,43 ms | 0,81 ms | 15 |
| 200 promociones, 10 niveles de prioridad (realista) | 0,79 ms | 1,06 ms | 1,41 ms | 56 |
| 200 promociones, misma prioridad (**peor caso**) | 4,28 ms | 4,76 ms | 5,01 ms | 44 |

## Lectura

- **SC-005 (< 300 ms al actualizar el carrito)**: el motor ocupa como mucho ~5 ms; el resto del presupuesto queda para red, sesión y lectura de promociones. **No se puede afirmar SC-005 de punta a punta** hasta medir el endpoint del carrito (spec 004) con la caché de T021 y la prueba k6 del Spec 1.
- **Meta interna del plan (< 5 ms)**: se cumple en p95 en todos los escenarios. El máximo del peor caso queda en el límite (5,01 ms).
- El peor caso es cuadrático en el número de promociones de un mismo nivel de prioridad: cada vez que se aplica una, se vuelven a evaluar las pendientes del nivel (research.md R5). Con prioridades repartidas el coste cae unas cinco veces. Si en producción hubiera cientos de promociones simultáneas en el mismo nivel, la mejora más sencilla sería descartar antes a las candidatas sin unidades en el alcance del carrito. Hoy no hace falta.

## Guarda de regresión

`dominio/motor-rendimiento.spec.ts` comprueba en cada ejecución de los unitarios que la mediana de ambos escenarios de 200 promociones sea < 50 ms (unas 10 veces lo medido). Así no falla por la velocidad de la máquina de CI, pero sí detecta un cambio que dispare la complejidad.

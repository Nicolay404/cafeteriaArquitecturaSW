# Research — Promociones y descuentos

Decisiones de la fase 0 del plan. Ninguna introduce dependencias nuevas.

## R1. Motor puro, separado de la E/S

- **Decisión**: `calcularCotizacion(entrada, promociones, instante)` es una función pura en `dominio/motor-precios.ts`. No lee la base de datos, ni el reloj, ni la caché.
- **Razón**: determinismo (US3.3), TDD rápido y la cobertura ≥ 95 % que exige la constitución. La simulación de FR-013 sale gratis: es el mismo motor con un `instante` futuro.
- **Alternativas**: reglas en SQL (difíciles de probar y de mantener deterministas); motor de reglas genérico (dependencia nueva injustificada).

## R2. Quién aporta los datos de Catálogo

- **Decisión**: quien llama (Carrito o Pedidos) envía por línea `productoId`, `categoriaIds`, `menuId`, `cantidad` y `precioBaseCentavos`, obtenidos de la interfaz pública de Catálogo. Promociones no consulta Catálogo durante el cálculo.
- **Razón**: Promociones no puede leer el esquema `catalog` (principio V), y así no depende de una interfaz de Catálogo que todavía no existe. Es seguro porque quien llama es otro módulo del servidor, nunca el navegador.
- **Pendiente**: validar al **guardar** una promoción que los IDs del alcance existen requiere la interfaz de Catálogo (bloqueado, ver plan).

## R3. Dinero y redondeo

- **Decisión**: importes en centavos enteros (`number` entero seguro, validado con `Number.isSafeInteger`); porcentajes en puntos básicos (`2000` = 20,00 %). Regla única de redondeo: el descuento porcentual de **cada unidad** se redondea al centavo con mitad hacia arriba: `floor((precio × pb + 5000) / 10000)`. Ningún descuento supera el precio restante de la unidad.
- **Razón**: aritmética exacta (constitución VI, FR-009). Redondear por unidad hace que el resultado no dependa del orden de las líneas.
- **Alternativas**: decimales con librería (dependencia nueva); redondeo bancario (menos intuitivo para el cliente, sin ventaja aquí).

## R4. Vigencia y zona horaria

- **Decisión**: la ventana es semiabierta `[inicio, fin)` en instantes UTC (`timestamptz`). El administrador las introduce en hora local de la cafetería (`America/Guayaquil`, configurable) y se convierten al guardar. La vigencia se evalúa en cada cálculo con el instante del servidor.
- **Razón**: evita que una promoción esté vigente dos veces en el borde y elimina el cron de activación (FR-005 se cumple con precisión exacta). Ecuador no tiene horario de verano, pero la conversión usa `Intl` y funciona igual con otra zona.
- **Alternativas**: job que cambia un estado `activa` cada minuto (más piezas, posible desfase, peor ante caídas).

## R5. Algoritmo de combinación (FR-007, US3)

Determinista y documentado; el carrito muestra qué promociones se aplicaron.

1. **Candidatas**: estado `activa`, `inicio ≤ t < fin`, monto mínimo cumplido (sobre el subtotal **bruto**, antes de descuentos), cupón presente si lo exige, usos disponibles.
2. Las unidades del carrito se expanden en «ranuras» (una por unidad; ≤ 50 por el límite del spec 004).
3. Las candidatas se agrupan por `prioridad` descendente. En cada nivel, mientras queden candidatas con beneficio > 0: se calcula el beneficio de cada una sobre las ranuras elegibles **en ese momento**, se aplica la de mayor beneficio (empate → `id` ascendente) y se retira del nivel.
4. **No acumulable**: solo puede usar ranuras sin ningún descuento y las **bloquea** para todas las demás.
   **Acumulable**: usa ranuras no bloqueadas (aunque ya tengan otro descuento acumulable) y descuenta sobre el precio restante.
5. Tipos:
   - **Porcentaje**: por unidad, con la regla de R3.
   - **Monto fijo**: por unidad, `min(monto, precio restante)` → nunca negativo (US2.2).
   - **N×M**: entre las ranuras elegibles del alcance, ordenadas por precio restante descendente (empate → `productoId`), cada grupo completo de N deja gratis sus N−M unidades más baratas. 3 unidades en 2x1 → paga 2 (US2.3).
   - **Consumo de grupos**: N×M y combo consumen **todas** las unidades de cada grupo o conjunto completo, también las que se pagan. Así, si no son acumulables, la unidad pagada de un 2x1 no recibe además otra promoción; las unidades sin grupo completo siguen libres (batería, casos 08, 20, 22 y 23).
   - **Combo**: conjunto de productos (con cantidades) y precio especial. Se forman tantos conjuntos completos como permitan las ranuras elegibles (edge case «varias veces»), tomando por producto las unidades de mayor precio restante. El descuento del conjunto (`suma − precio combo`, si es > 0) se reparte entre sus unidades proporcionalmente al precio, con el resto de centavos asignado por orden de ranura para que la suma sea exacta.
6. Resultado idéntico para el mismo carrito, mismas promociones y mismo instante, sin importar el orden de entrada (las líneas y promociones se ordenan por ID antes de calcular).

- **Razón**: respeta «mayor prioridad gana; a igual prioridad, la más favorable» (US3.1) y da un significado claro a «no acumulable = no se combina con ninguna otra».
- **Alternativas**: optimización global del mejor precio (exponencial, difícil de explicar al cliente).

## R6. Cupones

- **Decisión**: un cupón es un código compartido (supuesto del spec) asociado a una promoción, normalizado a mayúsculas sin espacios y guardado en claro (no es secreto: es un código de marketing). Un carrito admite un cupón en la v1. La cotización devuelve el estado del cupón: `aplicado`, `no_valido`, `monto_minimo` (con el faltante en centavos), `agotado` o `no_vigente`. `no_valido` no distingue entre inexistente y pausado.
- **Usos**: se consumen al confirmar el pedido (spec 006) con `UPDATE … SET usos = usos + 1 WHERE usos < limite`, idempotente por `(promocion_id, pedido_id)`; liberar uso si el pedido se cancela.
- **Intentos (FR-012)**: contador en Redis por sujeto (cliente cuando Identidad exista; IP hasta entonces) con ventana deslizante: 10 intentos fallidos / 15 min → bloqueo temporal con mensaje claro.

## R7. Auditoría (FR-014)

- **Decisión**: tabla `promotions.promotion_changes` solo de inserción (quién, cuándo, acción, estado anterior y nuevo en JSON). Reportes (spec 8) la consultará por la interfaz pública del módulo, no por SQL cruzado.

## R8. Caché de vigentes

- **Decisión**: Redis guarda las promociones `activa` cuya ventana no ha terminado, con TTL corto (60 s) e invalidación explícita al crear, editar, pausar o archivar. Como la vigencia se re-evalúa en el motor con el instante actual, una caché vieja nunca aplica una promoción fuera de su ventana; como mucho tarda ≤ 60 s en reflejar una edición si falla la invalidación.

## R9. Edición de promociones vigentes

- **Decisión**: editar actualiza la promoción y aplica desde ese momento; los pedidos ya confirmados guardan su copia (FR-011, spec 006). Se usa versión optimista (`version`) para que dos administradores no se pisen.

## Preguntas abiertas para el equipo (no bloquean el motor)

- Semántica de «Oferta» del draw.io (CU003) frente a Promociones (pendiente desde el Spec 1).
- Límite de intentos de cupón: los valores 10 / 15 min son propuesta; confirmar.
- ¿Se permite más de un cupón por carrito? Propuesta v1: uno.

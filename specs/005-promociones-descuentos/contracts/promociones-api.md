# Contrato: `PromocionesApi` (interfaz pública del módulo Promociones)

Consumidores: Carrito (spec 004) y Pedidos (spec 006). Se importa **solo** desde
`apps/api/src/modules/promociones/index.ts`. Estado: **borrador** hasta que el PR del spec 5 se
integre en `main`; los consumidores no deben declarar su integración lista antes.

```ts
/** Una línea ya resuelta por quien llama con los datos públicos de Catálogo. */
export interface LineaACotizar {
  productoId: string;
  categoriaIds: readonly string[];
  menuId: string;
  cantidad: number;            // entero ≥ 1
  precioBaseCentavos: number;  // entero ≥ 0, precio vigente según Catálogo
}

export interface SolicitudCotizacion {
  lineas: readonly LineaACotizar[];
  codigoCupon?: string;
  /** Solo para simulación del administrador; si falta, el servidor usa su reloj. */
  instante?: Date;
}

export interface PromocionAplicada {
  promocionId: string;
  nombre: string;
  descuentoCentavos: number;
}

export interface LineaCotizada {
  productoId: string;
  cantidad: number;
  precioBaseCentavos: number;
  subtotalCentavos: number;
  descuentoCentavos: number;
  totalCentavos: number;
  promociones: readonly PromocionAplicada[];
}

export type EstadoCupon =
  | { estado: 'aplicado'; promocionId: string }
  | { estado: 'monto_minimo'; faltanteCentavos: number }
  | { estado: 'agotado' | 'no_vigente' | 'no_valido' };

export interface Cotizacion {
  instante: string;            // ISO-8601 UTC del cálculo
  lineas: readonly LineaCotizada[];
  subtotalCentavos: number;
  descuentoCentavos: number;
  totalCentavos: number;       // ≥ 0
  promocionesAplicadas: readonly PromocionAplicada[]; // agregadas por promoción
  cupon?: EstadoCupon;         // solo si se envió codigoCupon
}

export interface PromocionesApi {
  cotizar(solicitud: SolicitudCotizacion): Promise<Cotizacion>;
  /** Pedidos (006): consume los usos de los cupones aplicados. Idempotente por pedidoId. */
  registrarUsos(pedidoId: string, promocionIds: readonly string[]): Promise<ResultadoUsos>;
  /** Pedidos (006): libera los usos al cancelar. Idempotente. */
  liberarUsos(pedidoId: string): Promise<void>;
}

export type ResultadoUsos = { ok: true } | { ok: false; agotadas: readonly string[] };
```

## Garantías

- Mismo `lineas` (en cualquier orden), mismas promociones y mismo `instante` → misma `Cotizacion`.
- `totalCentavos ≥ 0` en cada línea y en el total; `subtotal − descuento = total`.
- Todos los importes son enteros en centavos de USD.
- Una promoción fuera de `[inicio, fin)` o no `activa` nunca aparece en la cotización.
- `cotizar` no tiene efectos secundarios, salvo el contador de intentos de cupón fallidos (FR-012).
- Errores: `SolicitudInvalida` (cantidad o precio no enteros o negativos, línea duplicada por `productoId`), `DemasiadosIntentosCupon`.

## Lo que este contrato NO hace

- No comprueba disponibilidad ni existencias (Catálogo y Carrito).
- No reserva usos al cotizar: se consumen al confirmar el pedido.

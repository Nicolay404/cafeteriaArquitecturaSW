# Puertos del Carrito hacia otros módulos

Los define el Carrito como **consumidor**: describen lo que necesita, **no** son el contrato de
Catálogo ni de Promociones. Cuando esos módulos publiquen su interfaz en `main`, se escribe un
adaptador en `modules/carrito/infraestructura/`; si su forma difiere, se ajusta el adaptador y no el
dominio. Hasta entonces, solo hay dobles de prueba.

```ts
/** Lo que el Carrito necesita de Catálogo (spec 3). */
export interface ProductoParaCarrito {
  productoId: string;
  estado: 'disponible' | 'agotado' | 'retirado';
  precioBaseCentavos: number;
  categoriaIds: readonly string[];
  menuId: string;
  dentroDeHorario: boolean;
  existencias?: number; // solo si el producto gestiona existencias (spec 3, FR-008)
}
export interface CatalogoParaCarrito {
  /** Los IDs desconocidos no aparecen en el resultado. */
  productos(ids: readonly string[], instante: Date): Promise<ReadonlyMap<string, ProductoParaCarrito>>;
}

/** Lo que el Carrito necesita de Promociones (spec 5): coincide con PromocionesApi.cotizar. */
export interface PreciosParaCarrito {
  cotizar(solicitud: {
    lineas: readonly { productoId: string; categoriaIds: readonly string[]; menuId: string; cantidad: number; precioBaseCentavos: number }[];
    codigoCupon?: string;
    sujeto?: string;
  }): Promise<Cotizacion>; // tipo Cotizacion de contracts/promociones-api.md del spec 5
}
```

| Puerto | Proveedor | Estado |
|---|---|---|
| `CatalogoParaCarrito` | Catálogo (spec 3) | Sin interfaz publicada; propuesta para coordinar |
| `PreciosParaCarrito` | Promociones (spec 5) | `PromocionesApi` en borrador en `feature/spec-5`; conectar cuando se integre |
| `clienteId` de la sesión | Identidad (spec 2) | No definido aún entre módulos; coordinar |
| Evento `cliente.eliminado` | Clientes (spec 2) | Anunciado; el Carrito borrará el carrito del cliente |

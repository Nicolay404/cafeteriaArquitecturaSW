# Contrato: `CarritoApi` (interfaz pública del módulo Carrito)

Consumidor: Pedidos (spec 006). Se importa solo desde `apps/api/src/modules/carrito/index.ts`.
Estado: **borrador** hasta que el PR del spec 4 se integre en `main`.

```ts
export interface LineaParaPedido {
  productoId: string;
  cantidad: number;
}

export interface CarritoParaConfirmar {
  clienteId: string;
  version: number;
  lineas: readonly LineaParaPedido[];
  codigoCupon?: string;
  confirmable: boolean;
  avisos: readonly AvisoCarrito[]; // los que bloquean explican por qué no se puede confirmar
}

export interface CarritoApi {
  /** Estado actual para confirmar. Pedidos recalcula precios y disponibilidad por su cuenta. */
  paraConfirmar(clienteId: string): Promise<CarritoParaConfirmar>;
  /**
   * Vacía el carrito tras crear el pedido, solo si sigue en `version` (no borra lo que el cliente
   * añadió mientras tanto). Idempotente por `pedidoId`.
   */
  vaciarTrasPedido(clienteId: string, version: number, pedidoId: string): Promise<void>;
}
```

## Garantías

- `paraConfirmar` no modifica el carrito.
- `vaciarTrasPedido` repetido con el mismo `pedidoId` no tiene efecto adicional. Si el carrito cambió de versión, solo quita las cantidades que se pidieron.
- El carrito no reserva existencias: las reserva Pedidos al confirmar (supuesto del spec).

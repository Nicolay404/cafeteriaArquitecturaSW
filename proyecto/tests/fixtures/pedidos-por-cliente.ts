import type { PedidosPorCliente } from '../../apps/api/src/modules/clientes/index.js';
import type { PedidoResumen } from '../../packages/contracts/src/clientes.js';

/**
 * Doble en memoria del puerto PedidosPorCliente. El módulo Pedidos aún no existe (Spec #6): las
 * pruebas de historial y de eliminación usan este doble y NO prueban pedidos reales.
 */
export class PedidosEnMemoria implements PedidosPorCliente {
  private readonly pedidos = new Map<string, PedidoResumen[]>();

  agregar(personaId: string, pedido: PedidoResumen) {
    this.pedidos.set(personaId, [...(this.pedidos.get(personaId) ?? []), pedido]);
  }

  async listar(personaId: string) {
    return [...(this.pedidos.get(personaId) ?? [])].sort((a, b) => b.fecha.localeCompare(a.fecha));
  }

  async hayEnCurso(personaId: string) {
    return (this.pedidos.get(personaId) ?? []).some((pedido) =>
      ['pendiente', 'en_preparacion', 'listo'].includes(pedido.estado),
    );
  }
}

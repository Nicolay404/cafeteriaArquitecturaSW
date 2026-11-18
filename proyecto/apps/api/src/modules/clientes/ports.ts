import type { PedidoResumen } from '../../../../../packages/contracts/src/clientes.js';

// Interfaces públicas del módulo Clientes (constitución V: los módulos se hablan por interfaces,
// no por tablas ni por clases internas). La PII solo la maneja Clientes; el resto pide aquí lo
// mínimo imprescindible.

/** Datos de contacto de una persona; solo para enviarle un correo, nunca para mostrarlos o guardarlos. */
export interface ContactoDeCuenta {
  contactoDe(personaId: string): Promise<{ nombre: string; correo: string } | null>;
}

/**
 * Pedidos de un cliente. Lo implementa el módulo Pedidos (Spec #6); Clientes solo lo consume para
 * el historial (FR-011) y para saber si puede completar la eliminación de la cuenta (US4.4).
 */
export interface PedidosPorCliente {
  /** Más reciente primero. */
  listar(personaId: string): Promise<PedidoResumen[]>;
  hayEnCurso(personaId: string): Promise<boolean>;
}

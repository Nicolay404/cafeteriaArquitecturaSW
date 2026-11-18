// Aritmética exacta de dinero (constitución VI, FR-009; research.md R3).
// Importes en centavos enteros de USD y porcentajes en puntos básicos (2000 = 20,00 %).
// Nunca coma flotante con decimales: todas las operaciones son enteras y se comprueba que
// los resultados intermedios siguen siendo enteros seguros.

/** Importe en centavos de USD: entero seguro ≥ 0. */
export type Centavos = number;

export class ImporteInvalido extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ImporteInvalido';
  }
}

const PUNTOS_BASICOS_TOTALES = 10_000;

/** Valida que `valor` sea un importe en centavos (entero seguro y no negativo). */
export function centavos(valor: number, campo = 'importe'): Centavos {
  if (!Number.isSafeInteger(valor) || valor < 0) {
    throw new ImporteInvalido(
      `«${campo}» debe ser un número entero de centavos mayor o igual a 0 (recibido: ${String(valor)}).`,
    );
  }
  return valor;
}

/** Valida un porcentaje en puntos básicos: de 1 (0,01 %) a 10000 (100 %). */
export function puntosBasicos(valor: number, campo = 'puntosBasicos'): number {
  if (!Number.isSafeInteger(valor) || valor < 1 || valor > PUNTOS_BASICOS_TOTALES) {
    throw new ImporteInvalido(
      `«${campo}» debe ser un entero entre 1 y 10000 puntos básicos (0,01 % a 100 %).`,
    );
  }
  return valor;
}

/**
 * Descuento porcentual de UNA unidad, redondeado al centavo con mitad hacia arriba.
 * Es la única regla de redondeo del motor: se aplica por unidad para que el resultado no
 * dependa del orden de las líneas.
 */
export function descuentoPorcentual(precio: Centavos, pb: number): Centavos {
  centavos(precio, 'precio');
  puntosBasicos(pb);
  const producto = precio * pb;
  if (!Number.isSafeInteger(producto)) {
    throw new ImporteInvalido('El importe es demasiado grande para calcular el descuento.');
  }
  return Math.floor((producto + PUNTOS_BASICOS_TOTALES / 2) / PUNTOS_BASICOS_TOTALES);
}

/**
 * Reparte `total` centavos entre posiciones proporcionalmente a `pesos` (p. ej. el descuento de
 * un combo entre sus unidades). La parte entera va primero y los centavos sobrantes se asignan
 * uno a uno por orden de posición, así que la suma es exacta y el resultado determinista.
 * Requiere 0 ≤ total ≤ suma de pesos, de modo que ninguna parte supera su peso.
 */
export function repartirProporcional(total: Centavos, pesos: readonly Centavos[]): Centavos[] {
  centavos(total, 'total');
  pesos.forEach((peso) => centavos(peso, 'peso'));
  const suma = pesos.reduce((acumulado, peso) => acumulado + peso, 0);
  if (pesos.length === 0 || total > suma) {
    throw new ImporteInvalido('No se puede repartir un importe mayor que la suma de los pesos.');
  }
  if (!Number.isSafeInteger(total * suma)) {
    throw new ImporteInvalido('El importe es demasiado grande para repartirlo.');
  }
  const filas = pesos.map((peso) => ({ peso, parte: Math.floor((total * peso) / suma) }));
  let sobrante = total - filas.reduce((acumulado, fila) => acumulado + fila.parte, 0);
  // Cada vuelta da como mucho un centavo a cada posición con margen; como total ≤ suma, termina.
  while (sobrante > 0) {
    for (const fila of filas) {
      if (sobrante > 0 && fila.parte < fila.peso) {
        fila.parte += 1;
        sobrante -= 1;
      }
    }
  }
  return filas.map((fila) => fila.parte);
}

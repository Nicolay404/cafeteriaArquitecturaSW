// Entrada para la web y la API: solo los esquemas de cuenta. Next resuelve sus propias extensiones, así
// que aquí se importa con .ts (el índice completo usa .js para NodeNext y no sirve en el navegador).
export * from './identidad.ts';
export * from './clientes.ts';

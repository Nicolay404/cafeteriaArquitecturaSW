'use strict';

// Constitución VII: Conventional Commits con el módulo como alcance (`feat(pedidos): ...`).
// Un mismo archivo lo usan el hook local (Husky) y el pipeline, para que no puedan divergir.
const modules = [
  'identidad',
  'clientes',
  'catalogo',
  'promociones',
  'carrito',
  'pedidos',
  'pagos',
  'notificaciones',
  'reportes',
];

// Áreas transversales: plataforma y su infraestructura, la interfaz, el pipeline y la documentación.
const areas = [
  'plataforma',
  'infra',
  'ci',
  'deps',
  'config',
  'contratos',
  'ui',
  'web',
  'api',
  'worker',
  'seguridad',
  'calidad',
  'metricas',
  'observabilidad',
  'release',
  'docs',
  'specs',
  'speckit',
  'arquitectura',
];

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'test',
        'refactor',
        'perf',
        'build',
        'ci',
        'chore',
        'style',
        'revert',
      ],
    ],
    'scope-empty': [2, 'never'],
    'scope-enum': [2, 'always', [...modules, ...areas]],
    // Las descripciones están en español y empiezan con minúscula o con nombres propios.
    'subject-case': [0],
    'header-max-length': [2, 'always', 100],
    // Los cuerpos citan comandos y rutas largas; el límite de línea solo avisa.
    'body-max-line-length': [1, 'always', 120],
    'footer-max-line-length': [0],
  },
};

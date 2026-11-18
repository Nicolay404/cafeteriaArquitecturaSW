# T055 — reversibilidad en el staging LOCAL

2026-11-18, Windows 11, Docker Desktop. Staging = proyecto Compose `cafeteria-staging` (alcance-local.md): no hay `staging.yml` ni `render.yaml` evaluables, y no se afirma nada sobre una plataforma real.

## Cambio de flag sin redeploy

Con el candidato `cand-f06b2d643101` servido en staging (API en 5101, Redis publicado en 54100 solo en loopback):

| Paso | Resultado |
|---|---|
| `GET /platform/capacidad-prueba` inicial | 404 |
| `pnpm flags:set capacidad-tecnica-de-prueba on` (entorno staging) | revisión 1; la ruta pasa a **200** |
| `pnpm flags:set ... off` | revisión 2; la ruta vuelve a **404** |
| Contenedor de la API antes y después | el mismo (`003a25c22819`): sin redespliegue ni reinicio |
| `flags:set` con `APP_ENV=production` | rechazado: «fuera de local o del staging local hace falta la identidad del pipeline» |

`authorizeFlagWrite` ahora admite `local` y `staging` solo con Redis en loopback; producción y Redis remoto siguen rechazados (pruebas en `flags.int.spec.ts` y `cli.int.spec.ts`).

## Fallo de migración conserva N−1

`pnpm release --candidate cand-074f2e60acc8 --env staging --inject migrate` (staging servía `cand-f06b2d643101`):
estados `preparado → migrando → fallido`, sin pasos de backend ni web, causa registrada. Después, `/health` de staging siguió respondiendo la versión anterior (`b3e1d50…`).

## Límites

- Es un ensayo local con inyección de fallo, no una prueba contra Render.
- Las credenciales del staging local son las de pruebas de `.env.example`.

# Auditoría y depuración del workspace

Fecha: 2026-11-16. Rama feature/spec-1, misma raíz Git y sin commits/push. Alcance: comparar y depurar la migración; ninguna tarea adicional del Spec #1.

## Inspección previa

Ejecutados desde raíz Git: git branch --show-current, git status --short, git diff y git diff --cached. Rama correcta. El índice estaba vacío y los cambios locales existentes de .gitignore, .specify, CLAUDE.md, agentes, documentación y workspace se conservaron.

Comparación física archivo por archivo mediante SHA256, incluyendo archivos no rastreados e ignorados que fueran fuentes/configuración. Se excluyeron directorios node_modules, .turbo, .pnpm-store, .cache, .next, coverage, dist, build, .git y cachés de tests; no se siguieron junctions/enlaces. Los .env privados se excluyeron, sin moverlos ni borrarlos. Se compararon apps/packages/scripts/tests y las configuraciones de workspace presentes en cualquiera de las ubicaciones.

| Grupo | Archivos raíz | Archivos proyecto/ |
|---|---:|---:|
| apps | 0 | 31 |
| packages | 0 | 10 |
| scripts | 0 | 1 |
| tests | 0 | 1 |
| Configuración | 0 | 12 |

Resultado: 55 archivos exclusivamente dentro de proyecto/. Ningún archivo de código/configuración único en raíz, ningún duplicado idéntico y ninguna diferencia ambigua. No se asumió equivalencia por nombre de carpeta.

## Acciones

- Movidos: ninguno; no había fuentes de workspace pendientes en raíz.
- Duplicados de archivos eliminados: ninguno; no se encontraron.
- Directorios vacíos retirados individualmente: scripts/, tests/unit/ y tests/ de raíz. Se comprobó contenido vacío con GetFileSystemEntries, destino absoluto dentro del repositorio y ausencia de reparse point antes de cada Remove-Item -LiteralPath, sin -Recurse.
- Diferencias conservadas: no hubo conflictos de fuentes. Dependencias/cachés excluidas de raíz/apps/packages se conservaron sin borrar ni comparar su contenido; no forman un segundo workspace. La instalación activa de proyecto/ permanece intacta.
- Rutas corregidas en CLAUDE.md: apps/web → proyecto/apps/web y render.yaml → proyecto/render.yaml. Se mantuvo el cambio local previo @AGENTS.md y todo el resto del contenido; se verificó el hash de la reconstrucción inversa de esas dos sustituciones contra el original.
- Sin cambios a requisitos de spec.md, tareas/estados, plan, skills, constitución, docs, draw.io, agentes o configuración CI. Esta evidencia es nueva; la evidencia histórica se conserva.

## Verificación desde proyecto/

| Comando | Resultado |
|---|---|
| corepack.cmd pnpm@12.21.0 --recursive list --depth=-1 | Workspace único en proyecto/: raíz y seis paquetes privados |
| corepack.cmd pnpm@12.21.0 typecheck | Pasó: raíz comprobada y cinco paquetes con resultados de caché Turbo válidos; no se afirma recompilación nueva de esos cinco |
| corepack.cmd pnpm@12.21.0 lint | Pasó |
| corepack.cmd pnpm@12.21.0 format:check | Pasó |
| vitest run tests/unit/config.spec.ts | 11/11 pasaron, ejecución aprobada fuera del sandbox por restricción userInfo Windows/tsx conocida |
| node --env-file=.env.example --import tsx scripts/env-check.ts | Pasó sin crear .env ni imprimir valores privados |
| git check-ignore --no-index | node_modules/.turbo ignorados tanto en raíz como proyecto/; .env privados ignorados; proyecto/.env.example permitido |
| git ls-files --cached -- node_modules .turbo proyecto/node_modules proyecto/.turbo | Vacío: ninguna dependencia/caché agregada a Git |

No se reinstalaron dependencias ni se cambiaron manifiestos/lockfile. No se ejecutaron builds de aplicaciones, Compose, health, E2E, CI o despliegue porque no corresponden a los chequeos implementados actuales. No se usaron git clean, reset --hard ni borrados recursivos/masivos.

## Comparación completa

Cada fila incluye su ruta relativa al workspace, presencia y SHA256 actual. La columna raíz carece de archivo en todos los casos; las dependencias y cachés no forman parte de esta tabla.

| Ruta | Raíz Git | proyecto/ | SHA256 de proyecto/ |
|---|---|---|---|
| `apps/api/package.json` | Ausente | Conservado | `995CD6744CBECF489C0040DD4226AC826F5D279CFC45EC4320218DE0E6587570` |
| `apps/api/src/index.ts` | Ausente | Conservado | `8E609BB71C20B858C77F0E9F90BB1319DB8477B13F9F965F1A1E18524BF50881` |
| `apps/api/src/modules/carrito/carrito.module.ts` | Ausente | Conservado | `80B17B8B8C2FE7BAD59DC063236017ACC37A2A65D41280908E7B3444AF58F493` |
| `apps/api/src/modules/carrito/index.ts` | Ausente | Conservado | `817319A0FD19B5BB5BEDEC3341E51F2D26C1F0B427BBFD3604137B022E3FAA91` |
| `apps/api/src/modules/catalogo/catalogo.module.ts` | Ausente | Conservado | `DB637B5BE9CEACD1CE39BAC8C8FFC52E3896BEDFBF3900BAAF3F4120943BFD02` |
| `apps/api/src/modules/catalogo/index.ts` | Ausente | Conservado | `26453BABDF9747C7332C7CDC72B8273C2B801E64A46B28B28AD5767631784B50` |
| `apps/api/src/modules/clientes/clientes.module.ts` | Ausente | Conservado | `A2B136D149AC776ED6FC32ED4B180ACAB76E09A0195779FA07020DDFA67C2C3E` |
| `apps/api/src/modules/clientes/index.ts` | Ausente | Conservado | `21964A1C315B6C1FBCB6095C59385FE9CD44ED016BF6699F2A3E3BA7CD067458` |
| `apps/api/src/modules/identidad/identidad.module.ts` | Ausente | Conservado | `B58625582CC0C60AA59524CC1C02156F865F9A30AB643E349834E08619C5E179` |
| `apps/api/src/modules/identidad/index.ts` | Ausente | Conservado | `280B66A22EC3524ACE90FBF6C2F9074B889C92796F1E890161BB94C823607CD9` |
| `apps/api/src/modules/notificaciones/index.ts` | Ausente | Conservado | `D0726489AD0A54EB1D77187FDACB49CC79C7BFCE1F1BBD0F1D773B51A7361D49` |
| `apps/api/src/modules/notificaciones/notificaciones.module.ts` | Ausente | Conservado | `94A7B35361E8F3CE121496ED2BAC8299222ED0C6236D3AD4A94D578B6E176542` |
| `apps/api/src/modules/pagos/index.ts` | Ausente | Conservado | `9B676CB9F8D2C865788CE68870CC784389C485FC02726EF475DA8AA60CE719DA` |
| `apps/api/src/modules/pagos/pagos.module.ts` | Ausente | Conservado | `08EE631AABFD68411594F8B2A139D231143C71B380B3B96B5D76341759C3C3BE` |
| `apps/api/src/modules/pedidos/index.ts` | Ausente | Conservado | `B0AC88F21FBCA200AAD6103D6DAF3868F846E1D1345D440F777B3BA1E0234503` |
| `apps/api/src/modules/pedidos/pedidos.module.ts` | Ausente | Conservado | `D191BB11A2FB8826082D1F0BDE26913EC6DC38B20161E2C55AE10FE3E2E2C667` |
| `apps/api/src/modules/promociones/index.ts` | Ausente | Conservado | `0F42BB7FECFA8715E569FFB41EE7185D52413A1B787D4DC22848D54C0E071405` |
| `apps/api/src/modules/promociones/promociones.module.ts` | Ausente | Conservado | `0A63BC82067AB86C27FF2D3820268DA296964859A003A8A9C918F908C6789C31` |
| `apps/api/src/modules/README.md` | Ausente | Conservado | `648F4DEB202B74DFD2EFE2DA64111C8D2E45AA0E77F78646015959DCD54659CB` |
| `apps/api/src/modules/reportes/index.ts` | Ausente | Conservado | `301E38D981FD5FC27ADCCE8DC7EE098FD4AD4082D45E4A8C5D562CE10D4D6A38` |
| `apps/api/src/modules/reportes/reportes.module.ts` | Ausente | Conservado | `14A62DF1F57592F5080ED12A9275F902E1BB5CD6C95CD36A42C82432D157EF72` |
| `apps/api/src/platform/config.ts` | Ausente | Conservado | `6D5F76EE1C7D89E07FD7BFD6C96985AC89E7516A8148AA97E4B917B1917B5449` |
| `apps/api/tsconfig.json` | Ausente | Conservado | `D8D63223F2C952E6FBEE83288FE91F32607341FDABDA55B95A202E882FAE6929` |
| `apps/web/package.json` | Ausente | Conservado | `9DF3D2C15A628F88912A2AEC2FEEE772414365BAEEF6696780656ED2E29AA81C` |
| `apps/web/src/index.ts` | Ausente | Conservado | `8E609BB71C20B858C77F0E9F90BB1319DB8477B13F9F965F1A1E18524BF50881` |
| `apps/web/src/server/config.ts` | Ausente | Conservado | `19412152785CC710D3DAC5ED726FEBE1AF266CBC0F4A0502937855063297D070` |
| `apps/web/tsconfig.json` | Ausente | Conservado | `3DB5859907A790FA471830A2DD694FAE832CD8DD8BB47AC3FC8CB63453233D88` |
| `apps/worker/package.json` | Ausente | Conservado | `CFF53A2DCDC5B3A06F80B375D5D7280944C3679A8E1DDBA6286ECCD5DD9FFA06` |
| `apps/worker/src/config.ts` | Ausente | Conservado | `ECA96AD7C72412FE9E61B49384EBC54B42EC9913B75D9482C1B4403CD69DF82E` |
| `apps/worker/src/index.ts` | Ausente | Conservado | `8E609BB71C20B858C77F0E9F90BB1319DB8477B13F9F965F1A1E18524BF50881` |
| `apps/worker/tsconfig.json` | Ausente | Conservado | `D8D63223F2C952E6FBEE83288FE91F32607341FDABDA55B95A202E882FAE6929` |
| `packages/config/eslint.config.mjs` | Ausente | Conservado | `22AC233F2DD0E37A99C65581875C9794E55EAA6B4B66E7225BB0654054C0873F` |
| `packages/config/package.json` | Ausente | Conservado | `357F204FD22CBED6FB774EBCFB153D75C46F827F10ED1875E597BE70237A42F0` |
| `packages/config/src/env.ts` | Ausente | Conservado | `35D62502AB8308C8362F66E6D7AC28A0296A584BF3C7B3CEBAE5108E79CEF87E` |
| `packages/config/tsconfig.base.json` | Ausente | Conservado | `48FFD9E6C01F8C04C673EC6B662004A2A3B92E164C565EBDCA060704A8D96AEF` |
| `packages/contracts/package.json` | Ausente | Conservado | `86B6485C2C9FB85BED1E796DCC940BB6B52FC87179F470CFDA8F923DA16F6A25` |
| `packages/contracts/src/index.ts` | Ausente | Conservado | `8E609BB71C20B858C77F0E9F90BB1319DB8477B13F9F965F1A1E18524BF50881` |
| `packages/contracts/tsconfig.json` | Ausente | Conservado | `88D2F9EE2514237E85420A98559A0C1251E0324AF11D0C6F0BE3B520FE4E21EB` |
| `packages/ui/package.json` | Ausente | Conservado | `77CE6FB40E9F00C691200CE03FC1FB7A83FE52BD1603134360E305D634C10349` |
| `packages/ui/src/index.ts` | Ausente | Conservado | `8E609BB71C20B858C77F0E9F90BB1319DB8477B13F9F965F1A1E18524BF50881` |
| `packages/ui/tsconfig.json` | Ausente | Conservado | `88D2F9EE2514237E85420A98559A0C1251E0324AF11D0C6F0BE3B520FE4E21EB` |
| `scripts/env-check.ts` | Ausente | Conservado | `A39A9934F40D60E66C41FA98A50D141D4505497E49A9E7FE658CDA45301DB879` |
| `tests/unit/config.spec.ts` | Ausente | Conservado | `4FD4466F5CDBA2E0BA05A1C66D392FCF8E538BB8FC7130F11B6B51A95AC342F5` |
| `.dockerignore` | Ausente | Conservado | `1A007ACDB26EC7B3CF1276C869D734A53B73FF5D5A883AC02A31A77AB59D9558` |
| `.env.example` | Ausente | Conservado | `6953D51A0C237E979254182B7D207B9CB9D5613AA3A9FE1538BE17BF474DAB4B` |
| `.node-version` | Ausente | Conservado | `7C415154BB9F8E90394317C7109261249D2C4FBD549008AE6D014EE565EE7967` |
| `.npmrc` | Ausente | Conservado | `BEBAC611FA0EAD310569B888746BED5576FD447563B9EA25395383A7AC608AF0` |
| `.prettierignore` | Ausente | Conservado | `BE2446DD22367952997C79351BD8F119400965F17D4BE663B61215428AC2295F` |
| `.prettierrc.json` | Ausente | Conservado | `3DFACCCB5A3B7A9DCDEB33F53586EB9F004F7EE88EF17A70C6B5BF47346C2FEE` |
| `eslint.config.mjs` | Ausente | Conservado | `B79834C7BAF8AA31CA1FBFB8816151E694E48C60BA82E64692F98D90C002EEFC` |
| `package.json` | Ausente | Conservado | `32848037B7EE06991DBC1D7834A13AA2F09254E61FD5B04B876FEE629B881557` |
| `pnpm-lock.yaml` | Ausente | Conservado | `74F90AAA40C9030E23F5F8895C528D9DAD3FB79B64C5599185DAF4E6131620B2` |
| `pnpm-workspace.yaml` | Ausente | Conservado | `F843D92AAE2BC394D3A82EA1E2A258AEC1B03DABBA08699AF1573FCA8C08C2E7` |
| `tsconfig.json` | Ausente | Conservado | `F4D148E66BC8890C30449B5A263B6B1AD11C6F42ED5E9785F7AD6EC4CC245CC5` |
| `turbo.json` | Ausente | Conservado | `140D008B459CDDF92F253D7E762C8772EC049BC6F4E4E502A09C9A024329E742` |

Verificación de preservación: 1705 archivos iniciales de documentación/skills/agentes/configuración protegida mantienen su hash; CLAUDE.md solo tiene las dos rutas corregidas. Los 55 archivos comparados del workspace mantienen sus hashes originales de esta auditoría.

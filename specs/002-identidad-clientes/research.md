# Investigación — Spec #2 (decisiones técnicas)

Formato: decisión · razón · alternativas.

**D-01 Sesiones.** Token opaco de 256 bits en cookie `HttpOnly; Secure; SameSite=Lax`, guardado en Redis (la clave es el SHA-256 del token) con caducidad deslizante de 8 h y absoluta de 30 días; un índice por cuenta permite cortar todas las sesiones al desactivarla. Razón: revocación inmediata (US2.4) y servicio sin estado. Alternativas: JWT (no revocable sin lista), sesión en memoria (no escala).

**D-02 CSRF.** Token por sesión comprobado en cabecera en toda operación que cambia estado, además de `SameSite=Lax`. Razón: defensa en profundidad con cookies.

**D-03 Hash de contraseña.** Argon2id con `@node-rs/argon2` (mínimo OWASP m=19 MiB, t=2, p=1; calibrar a unos 100–250 ms). Alternativas: `argon2` (node-gyp, frágil en Windows y Alpine); bcrypt (la constitución exige Argon2id).

**D-04 Política.** Mínimo 12 y máximo 128 caracteres, sin reglas de composición (NIST 800-63B); se rechazan las comunes y las filtradas; se normaliza Unicode NFKC antes de hashear.

**D-05 Contraseñas filtradas.** Puerto `BreachedPasswordChecker`: (a) lista local de contraseñas comunes, siempre activa; (b) adaptador HIBP por k-anonimato (prefijo de 5 caracteres del SHA-1), apagado por defecto en local y con timeout corto; si falla, se aplica solo la lista local y se registra el evento. Razón: registrarse no debe depender de una red externa. Límite: la cobertura real de brechas solo se comprueba con HIBP activo (no evaluable aquí).

**D-06 Enlaces de un solo uso.** Tokens aleatorios de 256 bits; se guarda solo su hash con propósito, cuenta, caducidad (confirmar correo 24 h; recuperar 30 min, FR-003) y `usado_en`. El canje es atómico (`UPDATE ... WHERE usado_en IS NULL RETURNING`). Pedir uno nuevo invalida los anteriores del mismo propósito.

**D-07 No enumeración.** Registro, acceso y recuperación devuelven la misma respuesta y un tiempo similar; el titular recibe el aviso por correo (US1.2). Si la cuenta no existe se hace un hash ficticio para igualar el coste.

**D-08 Límites de intentos.** Ventana deslizante en Redis con script Lua atómico: acceso 5 fallos/15 min por cuenta y 20/15 min por IP; registro 5/hora por IP; recuperación 3/hora por cuenta. Al superarse: bloqueo temporal con `Retry-After` y un único aviso al titular por ventana. Con Redis caído el acceso falla cerrado (503), nunca sin límite.

**D-09 Segundo factor.** TOTP (6 dígitos, 30 s, ventana ±1) con el secreto cifrado en columna; activarlo exige un código válido; 10 códigos de recuperación con hash. Obligatorio para `personal` y `admin` antes de cualquier función de rol (guard); opcional para clientes. Solo un administrador lo restablece, con reautenticación y evento registrado. Cada paso TOTP se acepta una vez (se guarda el último usado).

**D-10 Roles.** Guard `@Roles()` por operación en el servidor; el rol vive en la cuenta, no en el token. Los accesos denegados generan evento de seguridad. Un cliente solo accede a lo suyo: el `clienteId` sale de la sesión, nunca del cuerpo de la petición.

**D-11 PII cifrada por columna.** AES-256-GCM con formato `v<k>:<iv>:<ct>:<tag>` y clave por versión para rotarla; el correo se busca con `HMAC-SHA256(correo normalizado, clave de índice)`. Identidad solo conoce ese índice. Alternativas: pgcrypto (la clave pasaría por SQL), cifrado de disco (no es por columna).

**D-12 Correo.** Puerto `MailPort` en Notificaciones con adaptador SMTP (Mailpit en local). Los mensajes pasan por outbox para no perderse si el SMTP falla y se reintentan. Los correos no llevan contraseñas ni tokens en el asunto. Identidad obtiene el contacto de Clientes por la interfaz pública `ContactoDeCuenta`.

**D-13 Eliminación.** Inmediata salvo pedidos en curso (entonces queda `pendiente_de_pedidos` y se completa por evento). En una transacción: borrar PII y consentimientos, dejar un perfil anónimo, desactivar la cuenta y cortar sesiones, emitir `cliente.eliminado` por outbox para que Pedidos anonimice. Se conserva un registro mínimo de la solicitud (tipo, fechas, estado, sin PII) como prueba de cumplimiento. Exige reautenticación de ≤ 5 min.

**D-14 Exportación.** JSON versionado (`cafeteria-export/1`) generado en la petición, con perfil, consentimientos, solicitudes y pedidos (por puerto); descarga autenticada con reautenticación, sin enviarlo por correo. Cumple SC-005 con holgura.

**D-15 Eventos de seguridad.** Tabla de solo inserción: tipo, cuenta, fecha, IP truncada (/24 en IPv4, /48 en IPv6) y agente resumido; sin contraseñas, tokens ni códigos. Retención de 12 meses (a confirmar).

**D-16 Primer administrador.** Script local `identity:seed-admin` con credenciales por variables de entorno y MFA pendiente; se niega con `APP_ENV=production`.

**D-17 Formularios accesibles.** Etiquetas visibles, `autocomplete` correcto (`username`, `new-password`, `one-time-code`), errores con `aria-describedby` y resumen enfocable, sin CAPTCHA ni límites de tiempo, mostrar u ocultar contraseña y mensajes que dicen cómo corregir.

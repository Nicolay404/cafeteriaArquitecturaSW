import { createTransport } from 'nodemailer';

// Research D-12: el resto de los módulos pide correos a Notificaciones solo por este puerto; no
// conocen SMTP. Los asuntos y cuerpos nunca llevan contraseñas, y los enlaces con token solo van
// en el cuerpo de texto plano (nunca en el asunto). Texto plano a propósito: es lo más accesible
// y evita rastreadores.

export type MailKind =
  | 'confirmar_correo'
  | 'cuenta_existente'
  | 'recuperar'
  | 'invitacion'
  | 'bloqueo'
  | 'cambio_correo_confirmar'
  | 'cambio_correo_aviso';

export interface MailData {
  nombre?: string;
  /** Enlace completo (ya con su token) que la persona debe abrir. */
  enlace?: string;
  minutos?: number;
}

export interface Mail {
  to: string;
  kind: MailKind;
  data?: MailData;
}

export interface MailPort {
  send(mail: Mail): Promise<void>;
}

export interface RenderedMail {
  subject: string;
  text: string;
}

const need = (value: string | undefined, label: string) => {
  if (!value) throw new Error(`La plantilla necesita «${label}»`);
  return value;
};

const greeting = (nombre: string | undefined) => (nombre ? `Hola, ${nombre}:` : 'Hola:');
const footer =
  'Si no fuiste tú, ignora este mensaje: no se hará ningún cambio. Nunca te pediremos tu contraseña por correo.';

export function renderMail(kind: MailKind, data: MailData = {}): RenderedMail {
  switch (kind) {
    case 'confirmar_correo':
      return {
        subject: 'Confirma tu correo',
        text: [
          greeting(data.nombre),
          '',
          'Para activar tu cuenta, abre este enlace. Caduca en 24 horas y solo funciona una vez:',
          need(data.enlace, 'enlace'),
          '',
          footer,
        ].join('\n'),
      };
    case 'cuenta_existente':
      // No incluye nombre ni enlace: no confirma nada a quien intentó registrarse con ese correo.
      return {
        subject: 'Alguien intentó registrarse con tu correo',
        text: [
          'Hola:',
          '',
          'Alguien intentó crear una cuenta con este correo, pero ya tienes una. Si fuiste tú, inicia sesión; si olvidaste tu contraseña, usa «Olvidé mi contraseña».',
          '',
          footer,
        ].join('\n'),
      };
    case 'recuperar':
      return {
        subject: 'Recupera tu contraseña',
        text: [
          greeting(data.nombre),
          '',
          `Para elegir una contraseña nueva, abre este enlace. Caduca en ${data.minutos ?? 30} minutos y solo funciona una vez:`,
          need(data.enlace, 'enlace'),
          '',
          footer,
        ].join('\n'),
      };
    case 'invitacion':
      return {
        subject: 'Te invitaron a la cafetería',
        text: [
          greeting(data.nombre),
          '',
          'Un administrador creó una cuenta para ti. Abre este enlace para elegir tu contraseña y configurar tu segundo factor de autenticación. Caduca en 72 horas y solo funciona una vez:',
          need(data.enlace, 'enlace'),
          '',
          footer,
        ].join('\n'),
      };
    case 'bloqueo':
      return {
        subject: 'Bloqueamos temporalmente el acceso a tu cuenta',
        text: [
          'Hola:',
          '',
          `Hubo demasiados intentos fallidos de iniciar sesión en tu cuenta. Por seguridad, bloqueamos nuevos intentos durante ${data.minutos ?? 15} minutos.`,
          'Si no fuiste tú, cambia tu contraseña cuando termine el bloqueo.',
        ].join('\n'),
      };
    case 'cambio_correo_confirmar':
      return {
        subject: 'Confirma tu nuevo correo',
        text: [
          greeting(data.nombre),
          '',
          'Para usar este correo en tu cuenta, abre este enlace. Caduca en 24 horas y solo funciona una vez:',
          need(data.enlace, 'enlace'),
          '',
          footer,
        ].join('\n'),
      };
    case 'cambio_correo_aviso':
      return {
        subject: 'Se pidió cambiar el correo de tu cuenta',
        text: [
          'Hola:',
          '',
          'Alguien pidió cambiar el correo de tu cuenta. El cambio solo se aplica si se confirma desde el correo nuevo.',
          'Si no fuiste tú, cambia tu contraseña ahora.',
        ].join('\n'),
      };
  }
}

export interface SmtpConfig {
  host: string;
  port: number;
  from?: string;
  /** Intentos totales ante un fallo transitorio; por defecto 3. */
  attempts?: number;
  /** Espera base entre intentos en ms (se duplica); por defecto 200. */
  backoffMs?: number;
}

const ADDRESS = /^[^\s@<>",;]+@[^\s@<>",;]+$/;

/** Adaptador SMTP (Mailpit en local). Reintenta con espera creciente ante fallos transitorios. */
export class SmtpMail implements MailPort {
  private readonly transport;
  private readonly from: string;
  private readonly attempts: number;
  private readonly backoffMs: number;

  constructor(config: SmtpConfig) {
    this.transport = createTransport({
      host: config.host,
      port: config.port,
      secure: false,
      connectionTimeout: 3000,
      greetingTimeout: 3000,
      socketTimeout: 5000,
    });
    this.from = config.from ?? 'Cafetería <no-responder@cafeteria.local>';
    this.attempts = config.attempts ?? 3;
    this.backoffMs = config.backoffMs ?? 200;
  }

  async send(mail: Mail): Promise<void> {
    // Validar antes de enviar evita inyección de cabeceras y envíos a direcciones mal formadas.
    if (!ADDRESS.test(mail.to)) throw new Error('Dirección de correo no válida');
    const { subject, text } = renderMail(mail.kind, mail.data);
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        await this.transport.sendMail({ from: this.from, to: mail.to, subject, text });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < this.attempts)
          await new Promise((resolve) => setTimeout(resolve, this.backoffMs * 2 ** (attempt - 1)));
      }
    }
    // Sin destinatario ni cuerpo en el mensaje de error.
    throw new Error(
      `No se pudo enviar el correo «${mail.kind}» tras ${this.attempts} intentos: ${
        lastError instanceof Error ? lastError.message : 'error desconocido'
      }`,
    );
  }

  close(): void {
    this.transport.close();
  }
}

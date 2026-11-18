import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import { SmtpMail, renderMail } from '../../apps/api/src/modules/notificaciones/index.js';
import type { MailKind } from '../../apps/api/src/modules/notificaciones/index.js';

// T011 — correo con Mailpit real: el adaptador SMTP entrega, las plantillas no filtran secretos
// y un destinatario inválido nunca llega a enviarse.
interface MailpitMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
  Snippet: string;
}

describe('T011 — correo con Mailpit real', () => {
  let mailpit: StartedTestContainer;
  let mail: SmtpMail;
  let ui = '';
  const link = `http://127.0.0.1:3000/confirmar?token=${'A'.repeat(43)}`;

  beforeAll(async () => {
    mailpit = await new GenericContainer(
      'axllent/mailpit:v1.33.1@sha256:aef2aacc11f075ec0fb6874275ee4a421e688e11a96ebb296134d1735c7761ce',
    )
      .withEnvironment({ MP_SMTP_DISABLE_RDNS: 'true' })
      .withExposedPorts(1025, 8025)
      .withWaitStrategy(Wait.forHttp('/readyz', 8025))
      .start();
    ui = `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`;
    mail = new SmtpMail({
      host: mailpit.getHost(),
      port: mailpit.getMappedPort(1025),
      backoffMs: 20,
    });
  });
  afterAll(async () => {
    mail?.close();
    await mailpit?.stop();
  });

  const inbox = async () =>
    ((await (await fetch(`${ui}/api/v1/messages`)).json()) as { messages: MailpitMessage[] })
      .messages;
  const body = async (id: string) =>
    ((await (await fetch(`${ui}/api/v1/message/${id}`)).json()) as { Text: string }).Text;

  test('entrega un correo de confirmación con el enlace solo en el cuerpo', async () => {
    await mail.send({
      to: 'ana@ejemplo.com',
      kind: 'confirmar_correo',
      data: { nombre: 'Ana', enlace: link },
    });
    const [message] = (await inbox()).filter((item) => item.To[0]?.Address === 'ana@ejemplo.com');
    expect(message?.Subject).toBe('Confirma tu correo');
    expect(message?.Subject).not.toContain('token');
    const text = await body(message!.ID);
    expect(text).toContain(link);
    expect(text).toContain('24 horas');
  });

  test('el aviso de cuenta existente no lleva nombre ni enlace', async () => {
    await mail.send({ to: 'titular@ejemplo.com', kind: 'cuenta_existente' });
    const message = (await inbox()).find((item) => item.To[0]?.Address === 'titular@ejemplo.com');
    const text = await body(message!.ID);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).toContain('ya tienes una');
  });

  test('ningún correo contiene la palabra «contraseña» como dato ni pide enviarla', () => {
    const kinds: MailKind[] = [
      'confirmar_correo',
      'cuenta_existente',
      'recuperar',
      'invitacion',
      'bloqueo',
      'cambio_correo_confirmar',
      'cambio_correo_aviso',
    ];
    for (const kind of kinds) {
      const { subject, text } = renderMail(kind, { enlace: link, nombre: 'Ana', minutos: 30 });
      expect(subject).not.toContain(link);
      expect(subject).not.toContain('token=');
      expect(text).not.toMatch(/tu contraseña es|envíanos tu contraseña/i);
    }
    expect(renderMail('recuperar', { enlace: link, minutos: 30 }).text).toContain('30 minutos');
  });

  test('las plantillas con enlace lo exigen', () => {
    for (const kind of [
      'confirmar_correo',
      'recuperar',
      'invitacion',
      'cambio_correo_confirmar',
    ] as const)
      expect(() => renderMail(kind, {})).toThrow(/enlace/);
  });

  test.each(['', 'sin-arroba', 'a@b.ec\r\nBcc: robo@mal.ec', 'a b@c.ec', '<a@b.ec>'])(
    'rechaza el destinatario «%s» sin tocar la red',
    async (to) => {
      await expect(mail.send({ to, kind: 'bloqueo' })).rejects.toThrow(/no válida/);
    },
  );

  test('si el SMTP no responde reintenta, falla sin filtrar el destinatario y se recupera', async () => {
    const broken = new SmtpMail({ host: '127.0.0.1', port: 1, attempts: 2, backoffMs: 10 });
    try {
      const error = await broken
        .send({ to: 'secreto@ejemplo.com', kind: 'bloqueo' })
        .catch((e) => e as Error);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/tras 2 intentos/);
      expect((error as Error).message).not.toContain('secreto@ejemplo.com');
    } finally {
      broken.close();
    }
    await expect(mail.send({ to: 'otra@ejemplo.com', kind: 'bloqueo' })).resolves.toBeUndefined();
  });
});

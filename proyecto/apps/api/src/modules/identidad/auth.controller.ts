import {
  Body,
  Catch,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { ZodType } from 'zod';
import {
  accesoRequest,
  camposDeError,
  correoRequest,
  registroRequest,
  restablecerRequest,
  tokenRequest,
} from '../../../../../packages/contracts/src/identidad.js';
import { Access, SESSION_COOKIE } from './guards.js';
import type { GuardedRequest } from './guards.js';
import { AuthError } from './auth-support.js';
import type { RequestContext } from './auth-support.js';
import type { LoginService } from './login.service.js';
import type { RegistrationService } from './registration.service.js';
import type { SessionStore } from './sessions.js';

// Rutas de US1 (contracts/identidad-clientes.md). Todas están detrás del flag
// `identidad-habilitada`: apagado, responden 404 como si no existieran. Las respuestas de registro,
// reenvío y recuperación son idénticas exista o no la cuenta (FR-006).

export const IDENTIDAD_DEPS = Symbol('IDENTIDAD_DEPS');

export interface IdentidadDeps {
  registration: RegistrationService;
  login: LoginService;
  sessions: SessionStore;
  isEnabled: () => Promise<boolean>;
  /** `Secure` en la cookie: siempre salvo en el entorno local sin HTTPS. */
  cookieSecure: boolean;
}

interface Response {
  setHeader(name: string, value: string): void;
  status(code: number): Response;
  json(body: unknown): void;
}
type Request = GuardedRequest;

/** Traduce los errores de negocio a la respuesta uniforme `{codigo, mensaje, campos?}`. */
@Catch(AuthError)
export class AuthErrorFilter implements ExceptionFilter {
  catch(error: AuthError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (error.options.retryAfterSeconds !== undefined)
      response.setHeader('Retry-After', String(error.options.retryAfterSeconds));
    response.setHeader('Cache-Control', 'no-store');
    response.status(error.status).json({
      codigo: error.codigo,
      mensaje: error.mensaje,
      ...(error.options.campos ? { campos: error.options.campos } : {}),
    });
  }
}

function parse<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const { mensaje, campos } = camposDeError(result.error);
  throw new AuthError(400, 'datos_invalidos', mensaje, { ...(campos ? { campos } : {}) });
}

const context = (request: Request): RequestContext => ({
  ip: request.ip,
  agente:
    typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : undefined,
});

@Controller('api/auth')
@UseFilters(AuthErrorFilter)
export class AuthController {
  constructor(@Inject(IDENTIDAD_DEPS) private readonly deps: IdentidadDeps) {}

  private async enabled() {
    if (!(await this.deps.isEnabled())) throw new NotFoundException();
  }

  private cookie(value: string, maxAge?: number) {
    return [
      `${SESSION_COOKIE}=${value}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      ...(this.deps.cookieSecure ? ['Secure'] : []),
      ...(maxAge !== undefined ? [`Max-Age=${maxAge}`] : []),
    ].join('; ');
  }

  @Post('registro')
  @HttpCode(202)
  async registro(@Body() body: unknown, @Req() request: Request) {
    await this.enabled();
    const data = parse(registroRequest, body);
    await this.deps.registration.register(data, context(request));
    return { mensaje: 'Si el correo es válido, te enviamos un mensaje para confirmar tu cuenta.' };
  }

  @Post('confirmar-correo')
  @HttpCode(204)
  async confirmar(@Body() body: unknown) {
    await this.enabled();
    await this.deps.registration.confirmEmail(parse(tokenRequest, body).token);
  }

  @Post('reenviar-confirmacion')
  @HttpCode(202)
  async reenviar(@Body() body: unknown, @Req() request: Request) {
    await this.enabled();
    await this.deps.registration.resendConfirmation(
      parse(correoRequest, body).correo,
      context(request),
    );
    return { mensaje: 'Si la cuenta existe y falta confirmarla, te enviamos un nuevo enlace.' };
  }

  @Post('acceso')
  @HttpCode(200)
  async acceso(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.enabled();
    const result = await this.deps.login.login(parse(accesoRequest, body), context(request));
    response.setHeader('Set-Cookie', this.cookie(result.token));
    response.setHeader('Cache-Control', 'no-store');
    return { requiereMfa: result.requiereMfa, rol: result.rol, csrf: result.csrf };
  }

  @Post('cierre')
  @HttpCode(204)
  @Access({ allowPartialMfa: true })
  async cierre(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.enabled();
    await this.deps.login.logout(request.sesionToken);
    response.setHeader('Set-Cookie', this.cookie('', 0));
  }

  @Post('recuperar')
  @HttpCode(202)
  async recuperar(@Body() body: unknown, @Req() request: Request) {
    await this.enabled();
    await this.deps.login.requestRecovery(parse(correoRequest, body).correo, context(request));
    return {
      mensaje: 'Si la cuenta existe, te enviamos un enlace para elegir una contraseña nueva.',
    };
  }

  @Post('restablecer')
  @HttpCode(204)
  async restablecer(@Body() body: unknown, @Req() request: Request) {
    await this.enabled();
    await this.deps.login.resetPassword(parse(restablecerRequest, body), context(request));
  }

  @Get('sesion')
  @Access({ allowPartialMfa: true })
  async sesion(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.enabled();
    response.setHeader('Cache-Control', 'no-store');
    const session = request.sesion!;
    return {
      rol: session.rol,
      nombre: await this.deps.login.displayName(session.cuentaId),
      mfaVerificado: session.mfaVerificado,
      csrf: session.csrf,
    };
  }
}

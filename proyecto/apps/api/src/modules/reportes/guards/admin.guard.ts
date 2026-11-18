import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

export interface AuthenticatedUser {
  id: string;
  role: string;
  email?: string;
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
      headers: Record<string, string | undefined>;
    }>();

    // Comprobar usuario autenticado en request o en encabezado para pruebas locales / gateway
    const userRole = request.user?.role ?? request.headers['x-user-role'];

    if (!userRole) {
      throw new UnauthorizedException(
        'Se requiere autenticación para acceder al panel de administración',
      );
    }

    if (userRole !== 'admin') {
      throw new ForbiddenException('Acceso denegado: se requiere rol de administrador');
    }

    return true;
  }
}

import { NextFunction, Request, RequestHandler, Response } from 'express';

/** App roles de Entra ID: ADMIN = administrador, EMPLOYEE = operador del hotel. */
export type RolInterno = 'ADMIN' | 'EMPLOYEE';

export function rolesDelToken(solicitud: Request): string[] {
	const roles = solicitud.user?.roles;
	return Array.isArray(roles) ? roles.filter((rol): rol is string => typeof rol === 'string') : [];
}

/**
 * Exige que el token (ya validado por authMiddleware) traiga al menos uno de los roles.
 * Con ENTRA_EXIGIR_ROL=false se omite, mientras los app roles no estén asignados en Entra ID
 * (mismo criterio que hotel-ms-rabbitmq-admin).
 */
export function exigirRol(...permitidos: RolInterno[]): RequestHandler {
	return (solicitud: Request, respuesta: Response, siguiente: NextFunction): void => {
		if (process.env.ENTRA_EXIGIR_ROL === 'false') {
			siguiente();
			return;
		}
		const roles = rolesDelToken(solicitud);
		if (!permitidos.some((rol) => roles.includes(rol))) {
			respuesta.status(403).json({ error: 'ROL_INSUFICIENTE', requerido: permitidos });
			return;
		}
		siguiente();
	};
}

import { Request, RequestHandler, Response } from 'express';
import { ISolicitudReporte } from '../config/models/reportes/ISolicitudReporte';
import { validarSolicitudReporte } from '../config/models/reportes/validarSolicitudReporte';
import { PublicadorEventos } from '../messaging/publicadorEventos';

function texto(valor: unknown): string | undefined {
	return typeof valor === 'string' && valor.trim() ? valor.trim() : undefined;
}

/**
 * POST /api/v1/admin/reportes { desde, hasta, email? }
 * Encola la generación del informe; el PDF lo arma hotel-ms-notificaciones y lo envía al administrador.
 * Si no viene email, se usa el del token (preferred_username / email / upn).
 */
export function crearReporteController(publicador: PublicadorEventos): RequestHandler {
	return async (solicitud: Request, respuesta: Response): Promise<void> => {
		const cuerpo = (typeof solicitud.body === 'object' && solicitud.body !== null ? solicitud.body : {}) as Record<string, unknown>;
		const claims = solicitud.user ?? {};

		const reporte: Partial<ISolicitudReporte> = {
			desde: texto(cuerpo.desde),
			hasta: texto(cuerpo.hasta),
			solicitadoPor: {
				nombre: texto(claims.name),
				email: texto(cuerpo.email) ?? texto(claims.preferred_username) ?? texto(claims.email) ?? texto(claims.upn) ?? ''
			}
		};

		const errores = validarSolicitudReporte(reporte);
		if (errores.length > 0) {
			respuesta.status(400).json({ error: 'VALIDACION_REPORTE', detalles: errores });
			return;
		}

		try {
			const id = await publicador.publicarReporteSolicitado(reporte as ISolicitudReporte);
			respuesta.status(202).json({ data: { id, estado: 'EN_COLA', ...reporte } });
		} catch {
			respuesta.status(503).json({ error: 'MENSAJERIA_NO_DISPONIBLE' });
		}
	};
}

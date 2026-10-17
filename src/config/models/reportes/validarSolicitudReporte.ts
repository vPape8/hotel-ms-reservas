import { ErrorValidacionReserva } from '../reservas/validarReserva';
import { ISolicitudReporte } from './ISolicitudReporte';

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS = 366;

function esFechaValida(valor: unknown): valor is string {
	return typeof valor === 'string' && FECHA_ISO.test(valor) && !Number.isNaN(Date.parse(`${valor}T00:00:00Z`));
}

export function validarSolicitudReporte(solicitud: Partial<ISolicitudReporte>): ErrorValidacionReserva[] {
	const errores: ErrorValidacionReserva[] = [];

	if (!esFechaValida(solicitud.desde)) {
		errores.push({ campo: 'desde', mensaje: 'Debe ser una fecha con formato YYYY-MM-DD' });
	}

	if (!esFechaValida(solicitud.hasta)) {
		errores.push({ campo: 'hasta', mensaje: 'Debe ser una fecha con formato YYYY-MM-DD' });
	}

	if (esFechaValida(solicitud.desde) && esFechaValida(solicitud.hasta)) {
		const dias = (Date.parse(solicitud.hasta) - Date.parse(solicitud.desde)) / 86_400_000;
		if (dias < 0) {
			errores.push({ campo: 'hasta', mensaje: 'Debe ser igual o posterior a la fecha desde' });
		} else if (dias > MAX_DIAS) {
			errores.push({ campo: 'hasta', mensaje: `El periodo no puede superar ${MAX_DIAS} días` });
		}
	}

	if (!solicitud.solicitadoPor?.email?.includes('@')) {
		errores.push({ campo: 'solicitadoPor.email', mensaje: 'El email del destinatario no es valido' });
	}

	return errores;
}

import { IncomingMessage, Server, ServerResponse, createServer } from 'node:http';
import { IReserva } from './config/models/IReserva';
import { validarReserva } from './config/models/reservas/validarReserva';

function responderJson(respuesta: ServerResponse, estado: number, cuerpo: unknown): void {
	respuesta.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8' });
	respuesta.end(JSON.stringify(cuerpo));
}

async function leerCuerpo(solicitud: IncomingMessage): Promise<unknown> {
	const partes: Buffer[] = [];

	for await (const parte of solicitud) {
		partes.push(Buffer.from(parte));
	}

	if (partes.length === 0) {
		return {};
	}

	return JSON.parse(Buffer.concat(partes).toString('utf8'));
}

function convertirReserva(payload: Record<string, unknown>): IReserva {
	return {
		...payload,
		fechaEntrada: new Date(String(payload.fechaEntrada)),
		fechaSalida: new Date(String(payload.fechaSalida))
	} as IReserva;
}

export function crearApp(): Server {
	return createServer(async (solicitud, respuesta) => {
		try {
			if (solicitud.method === 'GET' && solicitud.url === '/health') {
				responderJson(respuesta, 200, { status: 'ok' });
				return;
			}

			if (solicitud.method === 'POST' && solicitud.url === '/api/v1/user/reservas') {
				const cuerpo = await leerCuerpo(solicitud);
				const reserva = convertirReserva(cuerpo as Record<string, unknown>);
				const errores = validarReserva(reserva);

				if (errores.length > 0) {
					responderJson(respuesta, 400, { error: 'VALIDACION_RESERVA', detalles: errores });
					return;
				}

				responderJson(respuesta, 201, { data: reserva });
				return;
			}

			responderJson(respuesta, 404, { error: 'RUTA_NO_ENCONTRADA' });
		} catch {
			responderJson(respuesta, 400, { error: 'JSON_INVALIDO' });
		}
	});
}
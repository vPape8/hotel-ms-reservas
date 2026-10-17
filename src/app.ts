import express, { Express, NextFunction, Request, Response } from 'express';
import passport from 'passport';
import { IReserva } from './config/models/IReserva';
import { validarReserva } from './config/models/reservas/validarReserva';
import { authMiddleware } from './middlewares/authMiddleware';
import { meController } from './controllers/meController';
import { crearReporteController } from './controllers/reporteController';
import { crearPublicadorEventos, PublicadorEventos } from './messaging/publicadorEventos';

function convertirReserva(payload: Record<string, unknown>): IReserva {
	return {
		...payload,
		fechaEntrada: new Date(String(payload.fechaEntrada)),
		fechaSalida: new Date(String(payload.fechaSalida))
	} as IReserva;
}

export function crearApp(publicador: PublicadorEventos = crearPublicadorEventos()): Express {
	const app = express();

	app.use(express.json());
	app.use(passport.initialize());

	app.get('/health', (_solicitud, respuesta) => {
		respuesta.json({ status: 'ok' });
	});

	app.post('/api/v1/user/reservas', (solicitud: Request, respuesta: Response) => {
		const reserva = convertirReserva(solicitud.body as Record<string, unknown>);
		const errores = validarReserva(reserva);

		if (errores.length > 0) {
			respuesta.status(400).json({ error: 'VALIDACION_RESERVA', detalles: errores });
			return;
		}

		// Asíncrono: la reserva no espera al broker. Si falla, el publicador lo deja en el log.
		void publicador.publicarReservaCreada(reserva).catch(() => undefined);
		respuesta.status(201).json({ data: reserva });
	});

	app.get('/api/v1/me', authMiddleware, meController);
	app.post('/api/v1/admin/reportes', authMiddleware, crearReporteController(publicador));

	app.use((_solicitud, respuesta) => {
		respuesta.status(404).json({ error: 'RUTA_NO_ENCONTRADA' });
	});

	app.use((error: unknown, _solicitud: Request, respuesta: Response, _next: NextFunction) => {
		if (error instanceof SyntaxError) {
			respuesta.status(400).json({ error: 'JSON_INVALIDO' });
			return;
		}

		respuesta.status(500).json({ error: 'ERROR_INTERNO' });
	});

	return app;
}
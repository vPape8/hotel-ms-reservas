import express, { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import passport from 'passport';
import { crearPoolBaseDatos } from './config/database';
import { meController } from './controllers/meController';
import { crearReporteController } from './controllers/reporteController';
import { crearProductorEventosReserva, ProductorEventosReserva } from './messaging/kafka/productorEventosReserva';
import { crearPublicadorEventos, PublicadorEventos } from './messaging/publicadorEventos';
import { authMiddleware } from './middlewares/authMiddleware';
import { crearAutenticacionCognito } from './middlewares/cognitoMiddleware';
import { InMemoryReservaRepository, MySqlReservaRepository, ReservaRepository } from './repositories/reservaRepository';
import { crearReservaRoutes } from './routes/reservaRoutes';
import { ReservaService } from './services/reservaService';

export interface OpcionesApp {
	publicador?: PublicadorEventos;
	productorKafka?: ProductorEventosReserva;
	repositorio?: ReservaRepository;
	/** Entra ID (Admin / Operador). */
	autenticacion?: RequestHandler;
	/** Cognito (huésped registrado). */
	autenticacionCliente?: RequestHandler;
}

/** MySQL si MYSQL_HOST está definido; si no, memoria (tests y desarrollo sin base de datos). */
export function crearRepositorioReservas(): ReservaRepository {
	const pool = crearPoolBaseDatos();
	if (!pool) {
		console.warn(JSON.stringify({ servicio: 'hotel-ms-reservas', nivel: 'warn', evento: 'RESERVAS_EN_MEMORIA', detalle: 'MYSQL_HOST no definido' }));
		return new InMemoryReservaRepository();
	}
	return new MySqlReservaRepository(pool);
}

export function crearApp(opciones: OpcionesApp = {}): Express {
	const publicador = opciones.publicador ?? crearPublicadorEventos();
	const productorKafka = opciones.productorKafka ?? crearProductorEventosReserva();
	const servicio = new ReservaService(opciones.repositorio ?? crearRepositorioReservas(), publicador, productorKafka);
	const autenticacion = opciones.autenticacion ?? authMiddleware;
	const autenticacionCliente = opciones.autenticacionCliente ?? crearAutenticacionCognito();
	const app = express();

	app.use(express.json());
	app.use(passport.initialize());

	app.get('/health', (_solicitud, respuesta) => {
		respuesta.json({ status: 'ok' });
	});

	app.use('/api/v1', crearReservaRoutes(servicio, autenticacion, autenticacionCliente));
	app.get('/api/v1/me', autenticacion, meController);
	app.post('/api/v1/admin/reportes', autenticacion, crearReporteController(publicador));

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

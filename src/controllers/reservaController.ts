import { Request, Response } from 'express';
import { ESTADOS_RESERVA, EstadoReserva } from '../config/models/IReserva';
import { ErrorValidacionReserva } from '../config/models/reservas/validarReserva';
import { rolesDelToken } from '../middlewares/rolMiddleware';
import { FiltrosReserva } from '../repositories/reservaRepository';
import { CanalReserva } from '../config/models/IReserva';
import {
	Actor,
	ContextoOperacion,
	OperacionNoPermitidaError,
	ReservaDuplicadaError,
	ReservaNoEncontradaError,
	ReservaService,
	ReservaValidacionError,
	TransicionEstadoError
} from '../services/reservaService';

const TAMANO_MAXIMO = 100;

function cuerpo(solicitud: Request): Record<string, unknown> {
	return typeof solicitud.body === 'object' && solicitud.body !== null && !Array.isArray(solicitud.body)
		? solicitud.body as Record<string, unknown>
		: {};
}

function actorInterno(solicitud: Request): Actor {
	const claims = solicitud.user ?? {};
	const id = [claims.oid, claims.sub, claims.preferred_username].find((valor) => typeof valor === 'string') as string | undefined;
	return {
		tipo: 'INTERNO',
		id: id ?? 'desconocido',
		nombre: typeof claims.name === 'string' ? claims.name : undefined,
		roles: rolesDelToken(solicitud)
	};
}

/** Huésped de Cognito: el middleware ya validó el access_token y dejó su sub en solicitud.cliente. */
function actorCliente(solicitud: Request): Actor {
	const cliente = solicitud.cliente!;
	return { tipo: 'CLIENTE', id: cliente.sub, nombre: cliente.username };
}

/** IP del cliente: detrás del API Gateway viene en X-Forwarded-For (la primera es la original). */
function ipCliente(solicitud: Request): string | undefined {
	const reenviada = solicitud.header('x-forwarded-for')?.split(',')[0]?.trim();
	return reenviada || solicitud.socket.remoteAddress || undefined;
}

function contexto(solicitud: Request, actor: Actor, canal: CanalReserva): ContextoOperacion {
	const ip = ipCliente(solicitud);
	return { actor, origen: { canal, ...(ip ? { ip } : {}) } };
}

function parametro(solicitud: Request, nombre: string): string | undefined {
	const valor = solicitud.query[nombre];
	return typeof valor === 'string' && valor.trim() ? valor.trim() : undefined;
}

function fechaFiltro(valor: string | undefined, campo: string, errores: ErrorValidacionReserva[], finDelDia = false): Date | undefined {
	if (!valor) return undefined;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(valor) || Number.isNaN(Date.parse(valor))) {
		errores.push({ campo, mensaje: 'Debe ser una fecha con formato YYYY-MM-DD' });
		return undefined;
	}
	return new Date(`${valor}T${finDelDia ? '23:59:59.999' : '00:00:00.000'}Z`);
}

function entero(valor: string | undefined, campo: string, porDefecto: number, maximo: number, errores: ErrorValidacionReserva[]): number {
	if (!valor) return porDefecto;
	const numero = Number(valor);
	if (!Number.isInteger(numero) || numero < 1 || numero > maximo) {
		errores.push({ campo, mensaje: `Debe ser un entero entre 1 y ${maximo}` });
		return porDefecto;
	}
	return numero;
}

function responderError(respuesta: Response, error: unknown): void {
	if (error instanceof ReservaValidacionError) {
		respuesta.status(400).json({ error: 'VALIDACION_RESERVA', detalles: error.detalles });
	} else if (error instanceof ReservaNoEncontradaError) {
		respuesta.status(404).json({ error: 'RESERVA_NO_ENCONTRADA' });
	} else if (error instanceof ReservaDuplicadaError) {
		respuesta.status(409).json({ error: 'RESERVA_DUPLICADA', mensaje: error.message });
	} else if (error instanceof OperacionNoPermitidaError) {
		respuesta.status(403).json({ error: 'OPERACION_NO_PERMITIDA', mensaje: error.message });
	} else if (error instanceof TransicionEstadoError) {
		respuesta.status(409).json({ error: 'TRANSICION_INVALIDA', actual: error.actual, solicitado: error.nuevo });
	} else {
		console.error(JSON.stringify({ servicio: 'hotel-ms-reservas', nivel: 'error', evento: 'ERROR_RESERVAS', motivo: error instanceof Error ? error.message : String(error) }));
		respuesta.status(500).json({ error: 'ERROR_INTERNO' });
	}
}

export class ReservaController {
	constructor(private readonly servicio: ReservaService) {}

	/** POST /api/v1/user/reservas (pública): reserva como invitado desde la web de huéspedes. */
	crearPublica = async (solicitud: Request, respuesta: Response): Promise<void> => {
		try {
			const reserva = await this.servicio.crear(cuerpo(solicitud), contexto(solicitud, { tipo: 'INVITADO' }, 'WEB_HUESPEDES'));
			respuesta.status(201).json({ data: reserva });
		} catch (error) {
			responderError(respuesta, error);
		}
	};

	/** GET /api/v1/user/reservas/:codigo?email= (pública): consulta acotada con código y email. */
	consultarPublica = async (solicitud: Request, respuesta: Response): Promise<void> => {
		const email = parametro(solicitud, 'email');
		if (!email) {
			respuesta.status(400).json({ error: 'VALIDACION_RESERVA', detalles: [{ campo: 'email', mensaje: 'El email de la reserva es obligatorio' }] });
			return;
		}
		try {
			respuesta.json({ data: await this.servicio.consultarPublica(String(solicitud.params.codigo), email) });
		} catch (error) {
			responderError(respuesta, error);
		}
	};

	/** POST /api/v1/reservas (Admin u Operador). */
	crear = async (solicitud: Request, respuesta: Response): Promise<void> => {
		try {
			const reserva = await this.servicio.crear(cuerpo(solicitud), contexto(solicitud, actorInterno(solicitud), 'PANEL_ADMIN'));
			respuesta.status(201).json({ data: reserva });
		} catch (error) {
			responderError(respuesta, error);
		}
	};

	/** GET /api/v1/reservas?estado=&idHabitacion=&email=&desde=&hasta=&pagina=&tamano= (Admin u Operador). */
	listar = async (solicitud: Request, respuesta: Response): Promise<void> => {
		const errores: ErrorValidacionReserva[] = [];
		const estado = parametro(solicitud, 'estado');
		if (estado && !ESTADOS_RESERVA.includes(estado as EstadoReserva)) {
			errores.push({ campo: 'estado', mensaje: `Debe ser uno de: ${ESTADOS_RESERVA.join(', ')}` });
		}
		const filtros: FiltrosReserva = {
			estado: estado as EstadoReserva | undefined,
			idHabitacion: parametro(solicitud, 'idHabitacion'),
			email: parametro(solicitud, 'email'),
			desde: fechaFiltro(parametro(solicitud, 'desde'), 'desde', errores),
			hasta: fechaFiltro(parametro(solicitud, 'hasta'), 'hasta', errores, true),
			pagina: entero(parametro(solicitud, 'pagina'), 'pagina', 1, 100_000, errores),
			tamano: entero(parametro(solicitud, 'tamano'), 'tamano', 20, TAMANO_MAXIMO, errores)
		};
		if (errores.length > 0) {
			respuesta.status(400).json({ error: 'VALIDACION_FILTROS', detalles: errores });
			return;
		}
		try {
			const { reservas, total } = await this.servicio.listar(filtros);
			respuesta.json({ data: reservas, total, pagina: filtros.pagina, tamano: filtros.tamano });
		} catch (error) {
			responderError(respuesta, error);
		}
	};

	/** GET /api/v1/reservas/:id (Admin u Operador). */
	obtener = async (solicitud: Request, respuesta: Response): Promise<void> => {
		try {
			respuesta.json({ data: await this.servicio.obtener(String(solicitud.params.id)) });
		} catch (error) {
			responderError(respuesta, error);
		}
	};

	/** PATCH /api/v1/reservas/:id/estado { estado } (Admin u Operador). */
	cambiarEstado = async (solicitud: Request, respuesta: Response): Promise<void> => {
		try {
			respuesta.json({ data: await this.servicio.cambiarEstado(
				String(solicitud.params.id),
				cuerpo(solicitud).estado,
				contexto(solicitud, actorInterno(solicitud), 'PANEL_ADMIN')
			) });
		} catch (error) {
			responderError(respuesta, error);
		}
	};

	// ---------- Cliente (JWT de Cognito) ----------

	/** GET /api/v1/cliente/reservas?pagina=&tamano= : "Mis reservas". */
	listarCliente = async (solicitud: Request, respuesta: Response): Promise<void> => {
		const errores: ErrorValidacionReserva[] = [];
		const pagina = entero(parametro(solicitud, 'pagina'), 'pagina', 1, 100_000, errores);
		const tamano = entero(parametro(solicitud, 'tamano'), 'tamano', 20, TAMANO_MAXIMO, errores);
		if (errores.length > 0) {
			respuesta.status(400).json({ error: 'VALIDACION_FILTROS', detalles: errores });
			return;
		}
		try {
			const { reservas, total } = await this.servicio.listarDelCliente(solicitud.cliente!.sub, pagina, tamano);
			respuesta.json({ data: reservas, total, pagina, tamano });
		} catch (error) {
			responderError(respuesta, error);
		}
	};

	/** POST /api/v1/cliente/reservas : reservar con cuenta (queda a su nombre y parte en PENDIENTE). */
	crearCliente = async (solicitud: Request, respuesta: Response): Promise<void> => {
		try {
			const reserva = await this.servicio.crear(cuerpo(solicitud), contexto(solicitud, actorCliente(solicitud), 'WEB_HUESPEDES'));
			respuesta.status(201).json({ data: reserva });
		} catch (error) {
			responderError(respuesta, error);
		}
	};

	/** PATCH /api/v1/cliente/reservas/:codigo/estado { estado: "CANCELADA" } : solo cancelar, y solo las propias. */
	cancelarCliente = async (solicitud: Request, respuesta: Response): Promise<void> => {
		try {
			respuesta.json({ data: await this.servicio.cancelarDelCliente(
				String(solicitud.params.codigo),
				cuerpo(solicitud).estado,
				contexto(solicitud, actorCliente(solicitud), 'WEB_HUESPEDES')
			) });
		} catch (error) {
			responderError(respuesta, error);
		}
	};
}

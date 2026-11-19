import { randomUUID } from 'node:crypto';
import { CanalReserva, ESTADOS_RESERVA, EstadoReserva, IReserva } from '../config/models/IReserva';
import { puedeCambiarEstado } from '../config/models/reservas/estadosReserva';
import { ErrorValidacionReserva, validarReserva } from '../config/models/reservas/validarReserva';
import { ActorEventoDto, crearEventoReserva, OrigenEventoDto } from '../messaging/kafka/eventoReserva';
import { ProductorEventosReserva } from '../messaging/kafka/productorEventosReserva';
import { PublicadorEventos } from '../messaging/publicadorEventos';
import { FiltrosReserva, PaginaReservas, ReservaRepository } from '../repositories/reservaRepository';

/** Quién hace la operación: un usuario interno (Entra ID), un huésped registrado (Cognito) o un visitante sin login. */
export type Actor =
	| { tipo: 'INVITADO' }
	| { tipo: 'CLIENTE'; id: string; nombre?: string }
	| { tipo: 'INTERNO'; id: string; nombre?: string; roles: string[] };

/** Quién hace la operación y desde dónde: viaja en el evento de Kafka para la auditoría. */
export interface ContextoOperacion {
	actor: Actor;
	origen: OrigenEventoDto;
}

function actorEvento(actor: Actor): ActorEventoDto {
	switch (actor.tipo) {
		case 'INTERNO':
			return { tipo: 'INTERNO', id: actor.id, ...(actor.nombre ? { nombre: actor.nombre } : {}), roles: actor.roles };
		case 'CLIENTE':
			return { tipo: 'CLIENTE', id: actor.id, ...(actor.nombre ? { nombre: actor.nombre } : {}), roles: ['CLIENTE'] };
		default:
			return { tipo: 'INVITADO', id: 'invitado', roles: [] };
	}
}

/** Lo único que un huésped puede hacerle a su propia reserva. */
export class OperacionNoPermitidaError extends Error {}

/** Lo que ve un visitante al consultar con su código: sin datos de contacto ni de auditoría. */
export interface ReservaPublica {
	codigo: string;
	estado: EstadoReserva;
	idHabitacion: string;
	huesped: { nombre: string };
	fechaEntrada: Date;
	fechaSalida: Date;
	cantidadHuespedes: number;
	precioTotal: number;
}

export class ReservaValidacionError extends Error {
	constructor(readonly detalles: ErrorValidacionReserva[]) {
		super('La reserva no es válida');
	}
}
export class ReservaNoEncontradaError extends Error {}
export class ReservaDuplicadaError extends Error {}
export class TransicionEstadoError extends Error {
	constructor(readonly actual: EstadoReserva, readonly nuevo: EstadoReserva) {
		super(`No se puede pasar de ${actual} a ${nuevo}`);
	}
}

/** Estados con los que un usuario interno puede crear una reserva; un invitado siempre parte en PENDIENTE. */
const ESTADOS_INICIALES_INTERNOS: readonly EstadoReserva[] = ['PENDIENTE', 'CONFIRMADA'];

function generarCodigo(): string {
	return `RES-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function texto(valor: unknown): string | undefined {
	return typeof valor === 'string' && valor.trim() ? valor.trim() : undefined;
}

function convertirEntrada(cuerpo: Record<string, unknown>): Omit<IReserva, 'estado'> & { estado?: unknown } {
	const huesped = (typeof cuerpo.huesped === 'object' && cuerpo.huesped !== null ? cuerpo.huesped : {}) as Record<string, unknown>;
	return {
		codigo: texto(cuerpo.codigo) ?? generarCodigo(),
		idHabitacion: texto(cuerpo.idHabitacion) ?? '',
		huesped: {
			nombre: texto(huesped.nombre) ?? '',
			apellido: texto(huesped.apellido) ?? '',
			email: texto(huesped.email) ?? '',
			telefono: texto(huesped.telefono)
		},
		fechaEntrada: new Date(String(cuerpo.fechaEntrada)),
		fechaSalida: new Date(String(cuerpo.fechaSalida)),
		cantidadHuespedes: Number(cuerpo.cantidadHuespedes),
		estado: cuerpo.estado,
		precioPorNoche: Number(cuerpo.precioPorNoche),
		precioTotal: Number(cuerpo.precioTotal),
		observaciones: texto(cuerpo.observaciones)
	};
}

export class ReservaService {
	constructor(
		private readonly repositorio: ReservaRepository,
		private readonly publicador: PublicadorEventos,
		private readonly productorKafka: ProductorEventosReserva
	) {}

	/** Publica el evento en Kafka sin hacer esperar al usuario: si Kafka falla, el productor lo deja en el log. */
	private publicarEvento(reserva: IReserva, contexto: ContextoOperacion, estadoAnterior?: EstadoReserva): void {
		const evento = crearEventoReserva(reserva, actorEvento(contexto.actor), contexto.origen, estadoAnterior);
		void this.productorKafka.publicar(evento).catch(() => undefined);
	}

	async crear(cuerpo: Record<string, unknown>, contexto: ContextoOperacion): Promise<IReserva> {
		const { actor } = contexto;
		const canal: CanalReserva = contexto.origen.canal;
		const entrada = convertirEntrada(cuerpo);

		// Lo público queda acotado: un invitado no elige el estado, su reserva siempre parte en PENDIENTE.
		const estado: EstadoReserva = actor.tipo === 'INTERNO' && ESTADOS_INICIALES_INTERNOS.includes(entrada.estado as EstadoReserva)
			? entrada.estado as EstadoReserva
			: 'PENDIENTE';

		const ahora = new Date();
		const reserva: IReserva = {
			...entrada,
			id: randomUUID(),
			estado,
			// INTERNO: oid de Entra ID; CLIENTE: sub de Cognito (así aparece en "Mis reservas"); invitado: sin dueño.
			creadaPor: actor.tipo === 'INVITADO' ? 'invitado' : actor.id,
			canal,
			createdAt: ahora,
			updatedAt: ahora
		};

		const errores = validarReserva(reserva);
		if (errores.length > 0) {
			throw new ReservaValidacionError(errores);
		}
		if (await this.repositorio.buscarPorCodigo(reserva.codigo)) {
			throw new ReservaDuplicadaError(`Ya existe una reserva con el código ${reserva.codigo}`);
		}

		await this.repositorio.crear(reserva);
		// RabbitMQ (comando): enviar el correo de confirmación. Kafka (evento): reportes y auditoría.
		// Los dos son asíncronos: la respuesta no espera a los brokers.
		void this.publicador.publicarReservaCreada(reserva).catch(() => undefined);
		this.publicarEvento(reserva, contexto);
		return reserva;
	}

	async obtener(id: string): Promise<IReserva> {
		const reserva = await this.repositorio.buscarPorId(id);
		if (!reserva) {
			throw new ReservaNoEncontradaError('Reserva no encontrada');
		}
		return reserva;
	}

	/**
	 * Consulta pública: pide el código y el email del huésped, y responde igual si falta uno u otro,
	 * para que no se puedan adivinar códigos ajenos.
	 */
	async consultarPublica(codigo: string, email: string): Promise<ReservaPublica> {
		const reserva = await this.repositorio.buscarPorCodigo(codigo);
		if (!reserva || reserva.huesped.email.toLowerCase() !== email.trim().toLowerCase()) {
			throw new ReservaNoEncontradaError('Reserva no encontrada');
		}
		return {
			codigo: reserva.codigo,
			estado: reserva.estado,
			idHabitacion: reserva.idHabitacion,
			huesped: { nombre: reserva.huesped.nombre },
			fechaEntrada: reserva.fechaEntrada,
			fechaSalida: reserva.fechaSalida,
			cantidadHuespedes: reserva.cantidadHuespedes,
			precioTotal: reserva.precioTotal
		};
	}

	async listar(filtros: FiltrosReserva): Promise<PaginaReservas> {
		return this.repositorio.listar(filtros);
	}

	async cambiarEstado(id: string, nuevo: unknown, contexto: ContextoOperacion): Promise<IReserva> {
		if (!ESTADOS_RESERVA.includes(nuevo as EstadoReserva)) {
			throw new ReservaValidacionError([{ campo: 'estado', mensaje: `Debe ser uno de: ${ESTADOS_RESERVA.join(', ')}` }]);
		}
		return this.aplicarCambio(await this.obtener(id), nuevo as EstadoReserva, contexto);
	}

	// ---------- Cliente (huésped registrado en Cognito) ----------

	/** "Mis reservas": solo las que creó ese huésped con su cuenta. */
	async listarDelCliente(sub: string, pagina: number, tamano: number): Promise<PaginaReservas> {
		return this.repositorio.listar({ creadaPor: sub, pagina, tamano });
	}

	/** El huésped solo puede cancelar, y solo sus reservas. Una ajena responde igual que una inexistente. */
	async cancelarDelCliente(codigo: string, nuevo: unknown, contexto: ContextoOperacion): Promise<IReserva> {
		if (contexto.actor.tipo !== 'CLIENTE') {
			throw new OperacionNoPermitidaError('Solo un cliente cancela por esta vía');
		}
		if (nuevo !== 'CANCELADA') {
			throw new OperacionNoPermitidaError('Un cliente solo puede cancelar sus reservas');
		}
		const reserva = await this.repositorio.buscarPorCodigo(codigo);
		if (!reserva || reserva.creadaPor !== contexto.actor.id) {
			throw new ReservaNoEncontradaError('Reserva no encontrada');
		}
		return this.aplicarCambio(reserva, 'CANCELADA', contexto);
	}

	private async aplicarCambio(actual: IReserva, nuevo: EstadoReserva, contexto: ContextoOperacion): Promise<IReserva> {
		if (!puedeCambiarEstado(actual.estado, nuevo)) {
			throw new TransicionEstadoError(actual.estado, nuevo);
		}
		const actualizada = await this.repositorio.actualizarEstado(actual.id!, nuevo);
		if (!actualizada) {
			throw new ReservaNoEncontradaError('Reserva no encontrada');
		}
		// RabbitMQ (comando): avisar al huésped por correo. Kafka (evento): reportes, auditoría y catálogo.
		void this.publicador.publicarEstadoCambiado(actualizada, actual.estado).catch(() => undefined);
		this.publicarEvento(actualizada, contexto, actual.estado);
		return actualizada;
	}
}

import { randomUUID } from 'node:crypto';
import { CanalReserva, EstadoReserva, IReserva } from '../../config/models/IReserva';

export type TipoEventoReserva = 'RESERVA_CREADA' | 'RESERVA_CONFIRMADA' | 'RESERVA_CANCELADA' | 'RESERVA_COMPLETADA';

const TIPO_POR_ESTADO: Record<EstadoReserva, TipoEventoReserva> = {
	PENDIENTE: 'RESERVA_CREADA',
	CONFIRMADA: 'RESERVA_CONFIRMADA',
	CANCELADA: 'RESERVA_CANCELADA',
	COMPLETADA: 'RESERVA_COMPLETADA'
};

/** Quién hizo la acción (para la auditoría). */
export interface ActorEventoDto {
	/** INVITADO: sin login · CLIENTE: huésped de Cognito · INTERNO: Admin u Operador de Entra ID. */
	tipo: 'INVITADO' | 'CLIENTE' | 'INTERNO';
	id: string;
	nombre?: string;
	roles: string[];
}

/** Desde dónde se hizo (para la auditoría). */
export interface OrigenEventoDto {
	canal: CanalReserva;
	ip?: string;
}

/**
 * Evento del tópico "reservas". Lleva lo que necesitan los consumidores y nada más:
 * - reportes: estado, habitación, fechas, noches, huéspedes e ingresos;
 * - auditoría: quién (actor), desde dónde (origen), cuándo (ocurridoEn) y qué (tipo + estadoAnterior).
 * No viaja el email ni el teléfono del huésped: el historial dura 7 días y lo leen varios servicios.
 */
export interface ReservaEventoDto {
	eventoId: string;
	tipo: TipoEventoReserva;
	version: 1;
	ocurridoEn: string;
	actor: ActorEventoDto;
	origen: OrigenEventoDto;
	reserva: {
		id: string;
		codigo: string;
		idHabitacion: string;
		estado: EstadoReserva;
		estadoAnterior?: EstadoReserva;
		fechaEntrada: string;
		fechaSalida: string;
		noches: number;
		cantidadHuespedes: number;
		precioTotal: number;
	};
}

function noches(entrada: Date, salida: Date): number {
	return Math.max(1, Math.round((salida.getTime() - entrada.getTime()) / 86_400_000));
}

export function crearEventoReserva(
	reserva: IReserva,
	actor: ActorEventoDto,
	origen: OrigenEventoDto,
	estadoAnterior?: EstadoReserva
): ReservaEventoDto {
	return {
		eventoId: randomUUID(),
		// Sin estado anterior es una reserva nueva (aunque un usuario interno la cree ya CONFIRMADA).
		tipo: estadoAnterior ? TIPO_POR_ESTADO[reserva.estado] : 'RESERVA_CREADA',
		version: 1,
		ocurridoEn: new Date().toISOString(),
		actor,
		origen,
		reserva: {
			id: reserva.id!,
			codigo: reserva.codigo,
			idHabitacion: reserva.idHabitacion,
			estado: reserva.estado,
			...(estadoAnterior ? { estadoAnterior } : {}),
			fechaEntrada: reserva.fechaEntrada.toISOString(),
			fechaSalida: reserva.fechaSalida.toISOString(),
			noches: noches(reserva.fechaEntrada, reserva.fechaSalida),
			cantidadHuespedes: reserva.cantidadHuespedes,
			precioTotal: reserva.precioTotal
		}
	};
}

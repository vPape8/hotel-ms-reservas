export type EstadoReserva =
	| 'PENDIENTE'
	| 'CONFIRMADA'
	| 'CANCELADA'
	| 'COMPLETADA';

export const ESTADOS_RESERVA: readonly EstadoReserva[] = ['PENDIENTE', 'CONFIRMADA', 'CANCELADA', 'COMPLETADA'];

/** Por dónde entró la reserva: lo usa la auditoría ("desde dónde"). */
export type CanalReserva = 'WEB_HUESPEDES' | 'PANEL_ADMIN';

export interface IHuesped {
	nombre: string;
	apellido: string;
	email: string;
	telefono?: string;
}

export interface IReserva {
	id?: string;
	codigo: string;
	idHabitacion: string;
	huesped: IHuesped;
	fechaEntrada: Date;
	fechaSalida: Date;
	cantidadHuespedes: number;
	estado: EstadoReserva;
	precioPorNoche: number;
	precioTotal: number;
	observaciones?: string;
	/** Quién la creó: el id del usuario (oid de Entra ID) o "invitado" si fue sin login. */
	creadaPor?: string;
	canal?: CanalReserva;
	createdAt?: Date;
	updatedAt?: Date;
}

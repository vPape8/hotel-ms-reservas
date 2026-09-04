export type EstadoReserva =
	| 'PENDIENTE'
	| 'CONFIRMADA'
	| 'CANCELADA'
	| 'COMPLETADA';

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
	createdAt?: Date;
	updatedAt?: Date;
}

import { randomUUID } from 'node:crypto';
import { IReserva } from '../config/models/IReserva';

/** Sobre común de todos los mensajes del sistema: hotel-ms-notificaciones lee el mismo formato. */
export interface EventoDominio<T> {
	id: string;
	tipo: string;
	version: 1;
	origen: 'hotel-ms-reservas';
	ocurridoEn: string;
	datos: T;
}

export type ReservaPublicada = Omit<IReserva, 'fechaEntrada' | 'fechaSalida' | 'createdAt' | 'updatedAt'> & {
	fechaEntrada: string;
	fechaSalida: string;
};

export function crearEvento<T>(tipo: string, datos: T): EventoDominio<T> {
	return { id: randomUUID(), tipo, version: 1, origen: 'hotel-ms-reservas', ocurridoEn: new Date().toISOString(), datos };
}

export function reservaParaPublicar(reserva: IReserva): ReservaPublicada {
	const { createdAt: _creada, updatedAt: _actualizada, ...resto } = reserva;
	return {
		...resto,
		fechaEntrada: reserva.fechaEntrada.toISOString(),
		fechaSalida: reserva.fechaSalida.toISOString()
	};
}

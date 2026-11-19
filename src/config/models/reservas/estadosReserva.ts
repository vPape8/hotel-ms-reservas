import { EstadoReserva } from '../IReserva';

/**
 * Flujo de estados de una reserva:
 *   PENDIENTE  -> CONFIRMADA | CANCELADA
 *   CONFIRMADA -> COMPLETADA | CANCELADA
 *   CANCELADA y COMPLETADA son finales.
 */
const TRANSICIONES: Record<EstadoReserva, readonly EstadoReserva[]> = {
	PENDIENTE: ['CONFIRMADA', 'CANCELADA'],
	CONFIRMADA: ['COMPLETADA', 'CANCELADA'],
	CANCELADA: [],
	COMPLETADA: []
};

export function puedeCambiarEstado(actual: EstadoReserva, nuevo: EstadoReserva): boolean {
	return TRANSICIONES[actual].includes(nuevo);
}

export function estadosSiguientes(actual: EstadoReserva): readonly EstadoReserva[] {
	return TRANSICIONES[actual];
}

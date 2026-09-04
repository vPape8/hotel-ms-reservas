import { IReserva } from '../IReserva';

export interface ErrorValidacionReserva {
	campo: string;
	mensaje: string;
}

export function validarReserva(reserva: IReserva): ErrorValidacionReserva[] {
	const errores: ErrorValidacionReserva[] = [];

	if (!reserva.codigo.trim()) {
		errores.push({ campo: 'codigo', mensaje: 'El codigo es obligatorio' });
	}

	if (!reserva.idHabitacion.trim()) {
		errores.push({ campo: 'idHabitacion', mensaje: 'La habitacion es obligatoria' });
	}

	if (!reserva.huesped.nombre.trim() || !reserva.huesped.apellido.trim()) {
		errores.push({ campo: 'huesped', mensaje: 'El nombre y apellido son obligatorios' });
	}

	if (!reserva.huesped.email.includes('@')) {
		errores.push({ campo: 'huesped.email', mensaje: 'El email no es valido' });
	}

	if (!(reserva.fechaEntrada instanceof Date) || Number.isNaN(reserva.fechaEntrada.getTime())) {
		errores.push({ campo: 'fechaEntrada', mensaje: 'La fecha de entrada no es valida' });
	}

	if (!(reserva.fechaSalida instanceof Date) || Number.isNaN(reserva.fechaSalida.getTime())) {
		errores.push({ campo: 'fechaSalida', mensaje: 'La fecha de salida no es valida' });
	}

	if (reserva.fechaEntrada instanceof Date && reserva.fechaSalida instanceof Date && reserva.fechaSalida <= reserva.fechaEntrada) {
		errores.push({ campo: 'fechaSalida', mensaje: 'Debe ser posterior a la fecha de entrada' });
	}

	if (!Number.isInteger(reserva.cantidadHuespedes) || reserva.cantidadHuespedes < 1) {
		errores.push({ campo: 'cantidadHuespedes', mensaje: 'Debe ser un entero mayor que cero' });
	}

	if (reserva.precioPorNoche < 0 || !Number.isFinite(reserva.precioPorNoche)) {
		errores.push({ campo: 'precioPorNoche', mensaje: 'Debe ser un importe no negativo' });
	}

	if (reserva.precioTotal < 0 || !Number.isFinite(reserva.precioTotal)) {
		errores.push({ campo: 'precioTotal', mensaje: 'Debe ser un importe no negativo' });
	}

	return errores;
}
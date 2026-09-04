import assert from 'node:assert/strict';
import test from 'node:test';
import { IReserva } from '../IReserva';
import { validarReserva } from './validarReserva';

const reservaValida: IReserva = {
	codigo: 'RES-001',
	idHabitacion: 'HAB-101',
	huesped: {
		nombre: 'Ana',
		apellido: 'Perez',
		email: 'ana@example.com'
	},
	fechaEntrada: new Date('2026-10-01T15:00:00Z'),
	fechaSalida: new Date('2026-10-04T11:00:00Z'),
	cantidadHuespedes: 2,
	estado: 'PENDIENTE',
	precioPorNoche: 100,
	precioTotal: 300
};

test('acepta una reserva valida', () => {
	assert.deepEqual(validarReserva(reservaValida), []);
});

test('rechaza fechas invertidas e importes negativos', () => {
	const errores = validarReserva({
		...reservaValida,
		fechaSalida: new Date('2026-09-30T11:00:00Z'),
		precioTotal: -1
	});

	assert.ok(errores.some((error) => error.campo === 'fechaSalida'));
	assert.ok(errores.some((error) => error.campo === 'precioTotal'));
});
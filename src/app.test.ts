import assert from 'node:assert/strict';
import test from 'node:test';
import { AddressInfo } from 'node:net';
import { crearApp } from './app';

test('expone health check y valida la creacion de reservas', async (context) => {
	const servidor = crearApp().listen(0);
	await new Promise<void>((resolve, reject) => {
		servidor.once('listening', resolve);
		servidor.once('error', reject);
	});
	context.after(() => servidor.close());

	const puerto = (servidor.address() as AddressInfo).port;
	const baseUrl = `http://127.0.0.1:${puerto}`;

	const health = await fetch(`${baseUrl}/health`);
	assert.equal(health.status, 200);
	assert.deepEqual(await health.json(), { status: 'ok' });

	const meSinToken = await fetch(`${baseUrl}/api/v1/me`);
	assert.equal(meSinToken.status, 401);

	const reserva = await fetch(`${baseUrl}/api/v1/user/reservas`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			codigo: 'RES-002',
			idHabitacion: 'HAB-102',
			huesped: { nombre: 'Luis', apellido: 'Diaz', email: 'luis@example.com' },
			fechaEntrada: '2026-10-01T15:00:00Z',
			fechaSalida: '2026-10-02T11:00:00Z',
			cantidadHuespedes: 1,
			estado: 'PENDIENTE',
			precioPorNoche: 80,
			precioTotal: 80
		})
	});

	assert.equal(reserva.status, 201);

	const invalida = await fetch(`${baseUrl}/api/v1/user/reservas`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({})
	});

	assert.equal(invalida.status, 400);
});
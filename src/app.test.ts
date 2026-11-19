import assert from 'node:assert/strict';
import test from 'node:test';
import { AddressInfo } from 'node:net';
import { RequestHandler } from 'express';
import { crearApp } from './app';
import { IReserva } from './config/models/IReserva';
import { ReservaEventoDto } from './messaging/kafka/eventoReserva';
import { ProductorEventosReserva, serializarEvento } from './messaging/kafka/productorEventosReserva';
import { EstadoReserva } from './config/models/IReserva';
import { PublicadorDesactivado, routingKeyEstado } from './messaging/publicadorEventos';
import { InMemoryReservaRepository } from './repositories/reservaRepository';

/** Simula el JWT de Entra ID: "Bearer admin" → rol ADMIN, "Bearer operador" → EMPLOYEE, "Bearer sinrol" → sin roles. */
const autenticacionFalsa: RequestHandler = (solicitud, respuesta, siguiente) => {
	const token = solicitud.header('authorization')?.replace(/^Bearer\s+/i, '');
	const usuarios: Record<string, Express.User> = {
		admin: { oid: 'oid-admin', name: 'Admin Hotel', roles: ['ADMIN'] },
		operador: { oid: 'oid-operador', name: 'Operador Hotel', roles: ['EMPLOYEE'] },
		sinrol: { oid: 'oid-sinrol', roles: [] }
	};
	if (!token || !usuarios[token]) {
		respuesta.status(401).json({ error: 'TOKEN_REQUERIDO' });
		return;
	}
	solicitud.user = usuarios[token];
	siguiente();
};

/** Guarda los eventos en vez de mandarlos a Kafka. */
class ProductorFalso implements ProductorEventosReserva {
	readonly eventos: ReservaEventoDto[] = [];
	async publicar(evento: ReservaEventoDto): Promise<void> { this.eventos.push(evento); }
	async iniciar(): Promise<void> {}
	async cerrar(): Promise<void> {}
}

/** Guarda lo que iría a RabbitMQ: la routing key de cada mensaje publicado en el topic de reservas. */
class PublicadorFalso extends PublicadorDesactivado {
	readonly routingKeys: string[] = [];
	override async publicarReservaCreada(): Promise<void> { this.routingKeys.push('reserva.creada'); }
	override async publicarEstadoCambiado(reserva: IReserva, estadoAnterior: EstadoReserva): Promise<void> {
		this.routingKeys.push(`${routingKeyEstado(reserva.estado)} (antes ${estadoAnterior})`);
	}
}

const reservaHuesped = {
	codigo: 'RES-002',
	idHabitacion: 'HAB-102',
	huesped: { nombre: 'Luis', apellido: 'Diaz', email: 'luis@example.com' },
	fechaEntrada: '2026-10-01T15:00:00Z',
	fechaSalida: '2026-10-02T11:00:00Z',
	cantidadHuespedes: 1,
	estado: 'CONFIRMADA',
	precioPorNoche: 80,
	precioTotal: 80
};

test('reservas: público, protegido por rol y flujo de estados', async (contexto) => {
	const repositorio = new InMemoryReservaRepository();
	const kafka = new ProductorFalso();
	const rabbit = new PublicadorFalso();
	const servidor = crearApp({ publicador: rabbit, productorKafka: kafka, repositorio, autenticacion: autenticacionFalsa }).listen(0);
	await new Promise<void>((resolve, reject) => {
		servidor.once('listening', resolve);
		servidor.once('error', reject);
	});
	contexto.after(() => servidor.close());
	const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
	const json = (metodo: string, cuerpo: unknown, token?: string) => ({
		method: metodo,
		headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
		body: JSON.stringify(cuerpo)
	});
	const conToken = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
	let idReserva = '';

	await contexto.test('health y /me sin token', async () => {
		assert.deepEqual(await (await fetch(`${base}/health`)).json(), { status: 'ok' });
		assert.equal((await fetch(`${base}/api/v1/me`)).status, 401);
	});

	await contexto.test('un invitado reserva sin token, se guarda y parte en PENDIENTE aunque envíe otro estado', async () => {
		const respuesta = await fetch(`${base}/api/v1/user/reservas`, json('POST', reservaHuesped));
		assert.equal(respuesta.status, 201);
		const { data } = await respuesta.json() as { data: IReserva };
		assert.equal(data.estado, 'PENDIENTE');
		assert.equal(data.creadaPor, 'invitado');
		assert.equal(data.canal, 'WEB_HUESPEDES');
		assert.ok(data.id);
		idReserva = data.id!;
		assert.equal(repositorio.reservas.size, 1);
	});

	await contexto.test('rechaza datos inválidos y códigos repetidos', async () => {
		assert.equal((await fetch(`${base}/api/v1/user/reservas`, json('POST', {}))).status, 400);
		const repetida = await fetch(`${base}/api/v1/user/reservas`, json('POST', reservaHuesped));
		assert.equal(repetida.status, 409);
	});

	await contexto.test('consulta pública solo con código y email correctos, sin datos de contacto', async () => {
		const ok = await fetch(`${base}/api/v1/user/reservas/RES-002?email=LUIS@example.com`);
		assert.equal(ok.status, 200);
		const { data } = await ok.json() as { data: Record<string, unknown> };
		assert.equal(data.estado, 'PENDIENTE');
		assert.deepEqual(data.huesped, { nombre: 'Luis' });
		assert.equal(data.creadaPor, undefined);
		assert.equal((await fetch(`${base}/api/v1/user/reservas/RES-002?email=otro@example.com`)).status, 404);
		assert.equal((await fetch(`${base}/api/v1/user/reservas/RES-002`)).status, 400);
	});

	await contexto.test('las rutas internas exigen token y rol', async () => {
		assert.equal((await fetch(`${base}/api/v1/reservas`)).status, 401);
		assert.equal((await fetch(`${base}/api/v1/reservas`, conToken('sinrol'))).status, 403);
		const listado = await fetch(`${base}/api/v1/reservas?estado=PENDIENTE`, conToken('operador'));
		assert.equal(listado.status, 200);
		const cuerpo = await listado.json() as { data: IReserva[]; total: number };
		assert.equal(cuerpo.total, 1);
		assert.equal((await fetch(`${base}/api/v1/reservas?estado=RARO`, conToken('admin'))).status, 400);
		assert.equal((await fetch(`${base}/api/v1/reservas/${idReserva}`, conToken('admin'))).status, 200);
		assert.equal((await fetch(`${base}/api/v1/reservas/no-existe`, conToken('admin'))).status, 404);
	});

	await contexto.test('un usuario interno puede crear una reserva ya confirmada', async () => {
		const respuesta = await fetch(`${base}/api/v1/reservas`, json('POST', { ...reservaHuesped, codigo: 'RES-003' }, 'admin'));
		assert.equal(respuesta.status, 201);
		const { data } = await respuesta.json() as { data: IReserva };
		assert.equal(data.estado, 'CONFIRMADA');
		assert.equal(data.creadaPor, 'oid-admin');
		assert.equal(data.canal, 'PANEL_ADMIN');
	});

	await contexto.test('flujo de estados: PENDIENTE → CONFIRMADA → COMPLETADA, sin saltos ni vuelta atrás', async () => {
		const cambiar = (estado: string) => fetch(`${base}/api/v1/reservas/${idReserva}/estado`, json('PATCH', { estado }, 'operador'));
		assert.equal((await cambiar('COMPLETADA')).status, 409);
		assert.equal((await cambiar('INVENTADO')).status, 400);
		assert.equal((await cambiar('CONFIRMADA')).status, 200);
		assert.equal((await cambiar('COMPLETADA')).status, 200);
		const final = await cambiar('CANCELADA');
		assert.equal(final.status, 409);
		assert.deepEqual(await final.json(), { error: 'TRANSICION_INVALIDA', actual: 'COMPLETADA', solicitado: 'CANCELADA' });
	});

	await contexto.test('Kafka: un evento por creación y por cambio de estado, con actor y origen', async () => {
		assert.deepEqual(kafka.eventos.map((evento) => evento.tipo), [
			'RESERVA_CREADA', 'RESERVA_CREADA', 'RESERVA_CONFIRMADA', 'RESERVA_COMPLETADA'
		]);

		const [invitado, interno, confirmada] = kafka.eventos;
		assert.deepEqual(invitado.actor, { tipo: 'INVITADO', id: 'invitado', roles: [] });
		assert.equal(invitado.origen.canal, 'WEB_HUESPEDES');
		assert.equal(invitado.reserva.estado, 'PENDIENTE');
		assert.equal(invitado.reserva.noches, 1);
		assert.equal(interno.actor.id, 'oid-admin');
		assert.equal(interno.reserva.estado, 'CONFIRMADA');
		assert.equal(confirmada.actor.id, 'oid-operador');
		assert.equal(confirmada.reserva.estadoAnterior, 'PENDIENTE');

		// El evento no lleva datos de contacto del huésped.
		assert.equal(JSON.stringify(kafka.eventos).includes('luis@example.com'), false);

		// Serializer: key = habitación (misma partición), valor = JSON del DTO.
		const mensaje = serializarEvento(invitado);
		assert.equal(mensaje.key, 'HAB-102');
		assert.equal(mensaje.headers.tipo, 'RESERVA_CREADA');
		assert.deepEqual(JSON.parse(mensaje.value), invitado);
	});

	await contexto.test('RabbitMQ: correo al crear y aviso al huésped en cada cambio de estado', async () => {
		assert.deepEqual(rabbit.routingKeys, [
			'reserva.creada',
			'reserva.creada',
			'reserva.estado.confirmada (antes PENDIENTE)',
			'reserva.estado.completada (antes CONFIRMADA)'
		]);
	});
});

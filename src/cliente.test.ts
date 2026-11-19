import assert from 'node:assert/strict';
import test from 'node:test';
import { AddressInfo } from 'node:net';
import { RequestHandler } from 'express';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { crearApp } from './app';
import { ReservaEventoDto } from './messaging/kafka/eventoReserva';
import { ProductorEventosReserva } from './messaging/kafka/productorEventosReserva';
import { PublicadorDesactivado } from './messaging/publicadorEventos';
import { crearAutenticacionCognito } from './middlewares/cognitoMiddleware';
import { InMemoryReservaRepository } from './repositories/reservaRepository';

const ISSUER = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_PRUEBA';
const CLIENT_ID = 'cliente-frontend-huespedes';

class ProductorFalso implements ProductorEventosReserva {
	readonly eventos: ReservaEventoDto[] = [];
	async publicar(evento: ReservaEventoDto): Promise<void> { this.eventos.push(evento); }
	async iniciar(): Promise<void> {}
	async cerrar(): Promise<void> {}
}

/** Entra ID falso: solo acepta "Bearer admin". Un token de Cognito nunca es de Entra. */
const entraFalso: RequestHandler = (solicitud, respuesta, siguiente) => {
	if (solicitud.header('authorization') !== 'Bearer admin') {
		respuesta.status(401).json({ error: 'TOKEN_INVALIDO' });
		return;
	}
	solicitud.user = { oid: 'oid-admin', roles: ['ADMIN'] };
	siguiente();
};

const reserva = (codigo: string) => ({
	codigo,
	idHabitacion: 'vpo-001-room-1',
	huesped: { nombre: 'Ana', apellido: 'Pérez', email: 'ana@example.com' },
	fechaEntrada: '2026-12-01T15:00:00Z',
	fechaSalida: '2026-12-03T11:00:00Z',
	cantidadHuespedes: 2,
	estado: 'CONFIRMADA',
	precioPorNoche: 100,
	precioTotal: 200
});

test('cliente de Cognito: valida el access_token, ve y cancela solo sus reservas, no entra a lo interno', async (contexto) => {
	// Un User Pool de mentira: par de llaves propio y su JWKS local.
	const { publicKey, privateKey } = await generateKeyPair('RS256');
	const jwk = { ...(await exportJWK(publicKey)), kid: 'llave-1', alg: 'RS256' };
	const llaves = createLocalJWKSet({ keys: [jwk] });
	const firmar = (claims: Record<string, unknown>, issuer = ISSUER) => new SignJWT(claims)
		.setProtectedHeader({ alg: 'RS256', kid: 'llave-1' })
		.setIssuer(issuer)
		.setIssuedAt()
		.setExpirationTime('1h')
		.sign(privateKey);
	const accessToken = (sub: string, extra: Record<string, unknown> = {}) =>
		firmar({ sub, token_use: 'access', client_id: CLIENT_ID, username: sub, 'cognito:groups': ['CLIENTE'], ...extra });

	const kafka = new ProductorFalso();
	const servidor = crearApp({
		publicador: new PublicadorDesactivado(),
		productorKafka: kafka,
		repositorio: new InMemoryReservaRepository(),
		autenticacion: entraFalso,
		autenticacionCliente: crearAutenticacionCognito({ issuer: ISSUER, clientId: CLIENT_ID, grupoCliente: 'CLIENTE', exigirGrupo: true, llaves })
	}).listen(0);
	await new Promise<void>((resolve) => servidor.once('listening', resolve));
	contexto.after(() => servidor.close());
	const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/v1`;
	const llamar = (metodo: string, ruta: string, token?: string, cuerpo?: unknown) => fetch(`${base}${ruta}`, {
		method: metodo,
		headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
		...(cuerpo ? { body: JSON.stringify(cuerpo) } : {})
	});

	const ana = await accessToken('sub-ana');
	const luis = await accessToken('sub-luis');

	await contexto.test('rechaza tokens que no son el access_token del app client', async () => {
		assert.equal((await llamar('GET', '/cliente/reservas')).status, 401);
		assert.equal((await llamar('GET', '/cliente/reservas', await firmar({ sub: 'x', token_use: 'id', aud: CLIENT_ID }))).status, 401);
		assert.equal((await llamar('GET', '/cliente/reservas', await accessToken('x', { client_id: 'otra-app' }))).status, 401);
		assert.equal((await llamar('GET', '/cliente/reservas', await firmar({ sub: 'x', token_use: 'access', client_id: CLIENT_ID }, 'https://otro-issuer'))).status, 401);
		// Sin el grupo CLIENTE el token es válido pero no tiene el rol.
		assert.equal((await llamar('GET', '/cliente/reservas', await accessToken('x', { 'cognito:groups': [] }))).status, 403);
	});

	await contexto.test('reserva con cuenta: queda a su nombre, parte PENDIENTE y el evento dice CLIENTE', async () => {
		const respuesta = await llamar('POST', '/cliente/reservas', ana, reserva('RES-ANA'));
		assert.equal(respuesta.status, 201);
		const { data } = await respuesta.json() as { data: { estado: string; creadaPor: string } };
		assert.equal(data.estado, 'PENDIENTE');
		assert.equal(data.creadaPor, 'sub-ana');
		assert.deepEqual(kafka.eventos.at(-1)?.actor, { tipo: 'CLIENTE', id: 'sub-ana', nombre: 'sub-ana', roles: ['CLIENTE'] });
		assert.equal(kafka.eventos.at(-1)?.origen.canal, 'WEB_HUESPEDES');
		assert.equal((await llamar('POST', '/cliente/reservas', luis, reserva('RES-LUIS'))).status, 201);
	});

	await contexto.test('mis reservas: cada cliente ve solo las suyas', async () => {
		const { data, total } = await (await llamar('GET', '/cliente/reservas', ana)).json() as { data: { codigo: string }[]; total: number };
		assert.equal(total, 1);
		assert.equal(data[0]?.codigo, 'RES-ANA');
	});

	await contexto.test('solo puede cancelar, y solo lo propio', async () => {
		assert.equal((await llamar('PATCH', '/cliente/reservas/RES-ANA/estado', ana, { estado: 'CONFIRMADA' })).status, 403);
		assert.equal((await llamar('PATCH', '/cliente/reservas/RES-ANA/estado', luis, { estado: 'CANCELADA' })).status, 404);
		const cancelada = await llamar('PATCH', '/cliente/reservas/RES-ANA/estado', ana, { estado: 'CANCELADA' });
		assert.equal(cancelada.status, 200);
		assert.equal(kafka.eventos.at(-1)?.tipo, 'RESERVA_CANCELADA');
		assert.equal((await llamar('PATCH', '/cliente/reservas/RES-ANA/estado', ana, { estado: 'CANCELADA' })).status, 409);
	});

	await contexto.test('un token de cliente no abre las rutas de Admin u Operador', async () => {
		assert.equal((await llamar('GET', '/reservas', ana)).status, 401);
		assert.equal((await llamar('GET', '/reservas', 'admin')).status, 200);
	});
});

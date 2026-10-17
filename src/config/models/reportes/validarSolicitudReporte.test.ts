import assert from 'node:assert/strict';
import test from 'node:test';
import { validarSolicitudReporte } from './validarSolicitudReporte';

test('acepta una solicitud de reporte valida', () => {
	assert.deepEqual(validarSolicitudReporte({
		desde: '2026-10-01',
		hasta: '2026-10-31',
		solicitadoPor: { email: 'admin@hotel.cl' }
	}), []);
});

test('rechaza periodos invertidos, fechas mal formadas y email ausente', () => {
	const invertido = validarSolicitudReporte({ desde: '2026-10-31', hasta: '2026-10-01', solicitadoPor: { email: 'a@b.cl' } });
	assert.ok(invertido.some((error) => error.campo === 'hasta'));

	const malFormado = validarSolicitudReporte({ desde: '01-10-2026', hasta: '2026-10-31', solicitadoPor: { email: '' } });
	assert.ok(malFormado.some((error) => error.campo === 'desde'));
	assert.ok(malFormado.some((error) => error.campo === 'solicitadoPor.email'));
});

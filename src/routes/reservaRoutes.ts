import { RequestHandler, Router } from 'express';
import { ReservaController } from '../controllers/reservaController';
import { exigirRol } from '../middlewares/rolMiddleware';
import { ReservaService } from '../services/reservaService';

/**
 * Rutas de reservas (cada grupo con su autorizador, igual que en el API Gateway):
 *  - /user/reservas     públicas (sin token): reservar como invitado y consultar con código + email.
 *  - /cliente/reservas  JWT de Cognito, grupo CLIENTE: mis reservas, reservar con cuenta, cancelar una propia.
 *  - /reservas          JWT de Entra ID: Admin (ADMIN) y Operador (EMPLOYEE).
 */
export function crearReservaRoutes(servicio: ReservaService, autenticacion: RequestHandler, autenticacionCliente: RequestHandler): Router {
	const router = Router();
	const controlador = new ReservaController(servicio);
	const interno = [autenticacion, exigirRol('ADMIN', 'EMPLOYEE')];

	router.post('/user/reservas', controlador.crearPublica);
	router.get('/user/reservas/:codigo', controlador.consultarPublica);

	router.get('/cliente/reservas', autenticacionCliente, controlador.listarCliente);
	router.post('/cliente/reservas', autenticacionCliente, controlador.crearCliente);
	router.patch('/cliente/reservas/:codigo/estado', autenticacionCliente, controlador.cancelarCliente);

	router.get('/reservas', ...interno, controlador.listar);
	router.post('/reservas', ...interno, controlador.crear);
	router.get('/reservas/:id', ...interno, controlador.obtener);
	router.patch('/reservas/:id/estado', ...interno, controlador.cambiarEstado);

	return router;
}

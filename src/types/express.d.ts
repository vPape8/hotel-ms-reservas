import 'express';
import { ClienteCognito } from '../middlewares/cognitoMiddleware';

declare global {
	namespace Express {
		interface User {
			[key: string]: unknown;
		}
		interface Request {
			/** Huésped autenticado con Cognito (solo en las rutas /cliente). */
			cliente?: ClienteCognito;
		}
	}
}

export {};

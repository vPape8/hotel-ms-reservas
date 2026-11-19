import { NextFunction, Request, RequestHandler, Response } from 'express';
import { createRemoteJWKSet, errors, JWTPayload, jwtVerify, JWTVerifyGetKey } from 'jose';
import { cognitoConfig } from '../config/cognito.config';

/** Huésped registrado en Cognito, sacado del access_token ya validado. */
export interface ClienteCognito {
	/** sub: id del usuario en el User Pool. Es el dueño de sus reservas (creadaPor). */
	sub: string;
	username: string;
	grupos: string[];
}

export interface OpcionesCognito {
	issuer: string;
	clientId: string;
	grupoCliente: string;
	exigirGrupo: boolean;
	/** Llaves públicas del User Pool (JWKS). En los tests se pasa un JWKS local. */
	llaves?: JWTVerifyGetKey;
}

interface PayloadCognito extends JWTPayload {
	token_use?: unknown;
	client_id?: unknown;
	username?: unknown;
	'cognito:groups'?: unknown;
}

/**
 * Valida el access_token de Cognito que el frontend de huéspedes envía como Bearer (guía EFT, T03):
 *  - firma con las llaves del User Pool (JWKS) y vigencia;
 *  - issuer = el User Pool;
 *  - token_use = "access" y client_id = el app client del frontend (el access_token no trae "aud");
 *  - grupo CLIENTE en cognito:groups (el rol viaja en el token, T05).
 * Un token de Entra ID no pasa (otro issuer y otras llaves), y uno de Cognito no pasa por las rutas internas:
 * el rol lo decide quién emitió el token.
 */
export function crearAutenticacionCognito(opciones: OpcionesCognito = cognitoConfig): RequestHandler {
	let llaves = opciones.llaves;

	return (solicitud: Request, respuesta: Response, siguiente: NextFunction): void => {
		const token = /^Bearer\s+(\S+)$/i.exec(solicitud.header('authorization') ?? '')?.[1];
		if (!token) {
			respuesta.status(401).json({ error: 'TOKEN_REQUERIDO' });
			return;
		}
		if (!opciones.issuer || !opciones.clientId) {
			respuesta.status(500).json({ error: 'AUTENTICACION_COGNITO_NO_CONFIGURADA' });
			return;
		}
		llaves ??= createRemoteJWKSet(new URL(`${opciones.issuer.replace(/\/$/, '')}/.well-known/jwks.json`));

		jwtVerify(token, llaves, { issuer: opciones.issuer })
			.then(({ payload }) => {
				const datos = payload as PayloadCognito;
				if (datos.token_use !== 'access' || datos.client_id !== opciones.clientId || typeof datos.sub !== 'string') {
					respuesta.status(401).json({ error: 'TOKEN_INVALIDO' });
					return;
				}
				const grupos = Array.isArray(datos['cognito:groups'])
					? datos['cognito:groups'].filter((grupo): grupo is string => typeof grupo === 'string')
					: [];
				if (opciones.exigirGrupo && !grupos.includes(opciones.grupoCliente)) {
					respuesta.status(403).json({ error: 'ROL_INSUFICIENTE', requerido: [opciones.grupoCliente] });
					return;
				}
				solicitud.cliente = { sub: datos.sub, username: typeof datos.username === 'string' ? datos.username : datos.sub, grupos };
				siguiente();
			})
			.catch((error: unknown) => {
				// Firma, issuer o vigencia inválidos: 401. Si el JWKS no responde, es un problema nuestro: 503.
				const esDelToken = error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout);
				respuesta.status(esDelToken ? 401 : 503).json({ error: esDelToken ? 'TOKEN_INVALIDO' : 'COGNITO_NO_DISPONIBLE' });
			});
	};
}

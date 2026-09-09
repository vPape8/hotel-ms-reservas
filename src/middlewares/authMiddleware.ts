import passport from 'passport';
import { BearerStrategy, IBearerStrategyOption } from 'passport-azure-ad';
import { NextFunction, Request, Response } from 'express';

const strategyName = 'azure-ad-bearer';
let strategyConfigured = false;

function configureStrategy(): void {
	if (strategyConfigured) {
		return;
	}

	const tenantId = process.env.AZURE_TENANT_ID;
	const clientId = process.env.AZURE_CLIENT_ID;

	if (!tenantId || !clientId) {
		throw new Error('AZURE_TENANT_ID y AZURE_CLIENT_ID son obligatorias');
	}

	const issuer = process.env.AZURE_ISSUER ?? `https://login.microsoftonline.com/${tenantId}/v2.0`;
	const identityMetadata = process.env.AZURE_IDENTITY_METADATA ??
		`https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`;

	const options: IBearerStrategyOption = {
		identityMetadata,
		clientID: clientId,
		validateIssuer: true,
		issuer,
		isB2C: false,
		loggingLevel: 'error'
	};

	passport.use(strategyName, new BearerStrategy(options, (token, done) => {
		done(null, token);
	}));
	strategyConfigured = true;
}

export function authMiddleware(solicitud: Request, respuesta: Response, siguiente: NextFunction): void {
	const authorization = solicitud.header('authorization');

	if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
		respuesta.status(401).json({ error: 'TOKEN_REQUERIDO' });
		return;
	}

	try {
		configureStrategy();
	} catch {
		respuesta.status(500).json({ error: 'AUTENTICACION_NO_CONFIGURADA' });
		return;
	}

	passport.authenticate(strategyName, { session: false }, (error: unknown, usuario: Express.User | false | null) => {
		if (error || !usuario) {
			respuesta.status(401).json({ error: 'TOKEN_INVALIDO' });
			return;
		}

		solicitud.user = usuario;
		siguiente();
	})(solicitud, respuesta, siguiente);
}
// Configuración de AWS Cognito (User Pool de huéspedes). Los tokens de Cognito solo abren las rutas /cliente.

function texto(variable: string | undefined): string {
	return (variable ?? '').trim();
}

const region = texto(process.env.COGNITO_REGION) || 'us-east-1';
const userPoolId = texto(process.env.COGNITO_USER_POOL_ID);

export const cognitoConfig = {
	region,
	userPoolId,
	/** iss del token: https://cognito-idp.<region>.amazonaws.com/<userPoolId>. */
	issuer: texto(process.env.COGNITO_ISSUER) || (userPoolId ? `https://cognito-idp.${region}.amazonaws.com/${userPoolId}` : ''),
	/** App client público (sin secreto) del frontend de huéspedes: el access_token lo trae en el claim client_id. */
	clientId: texto(process.env.COGNITO_CLIENT_ID),
	/** Grupo del User Pool al que la Lambda post-confirmación agrega a cada huésped que se registra. */
	grupoCliente: texto(process.env.COGNITO_GRUPO_CLIENTE) || 'CLIENTE',
	/** false: no exige el grupo (mientras la Lambda no esté creada). Mismo criterio que ENTRA_EXIGIR_ROL. */
	exigirGrupo: process.env.COGNITO_EXIGIR_GRUPO !== 'false'
} as const;

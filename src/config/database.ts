import { createPool, Pool } from 'mysql2/promise';

/**
 * Pool de MySQL. Si MYSQL_HOST no está definido devuelve undefined y el servicio guarda las reservas
 * en memoria (tests y desarrollo sin base de datos), igual que el publicador de RabbitMQ sin RABBITMQ_URL.
 */
export function crearPoolBaseDatos(): Pool | undefined {
	if (!process.env.MYSQL_HOST) {
		return undefined;
	}

	return createPool({
		host: process.env.MYSQL_HOST,
		port: Number(process.env.MYSQL_PORT ?? 3306),
		user: process.env.MYSQL_USER ?? 'root',
		password: process.env.MYSQL_PASSWORD ?? '',
		database: process.env.MYSQL_DATABASE ?? 'hotel',
		waitForConnections: true,
		connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT ?? 10),
		dateStrings: false
	});
}

// Configuración centralizada de RabbitMQ (equivalente a application.yml / clase @Configuration).
// Ningún otro archivo escribe nombres de exchanges, colas o routing keys a mano: todos se leen de aquí.
// Los nombres deben coincidir con los de hotel-ms-notificaciones y hotel-ms-rabbitmq-admin.

export const rabbitConfig = {
	/** amqp://usuario:clave@host:5672. Si está vacía, la mensajería queda desactivada (tests y desarrollo sin broker). */
	url: process.env.RABBITMQ_URL ?? '',
	reconexionMs: Number(process.env.RABBITMQ_RECONEXION_MS ?? 5000),

	exchanges: {
		/** Topic: reserva.creada (flujo del usuario: confirmación por correo). */
		reservas: process.env.RABBITMQ_EXCHANGE_RESERVAS ?? 'hotel.reservas.exchange',
		/** Fanout ("EX F" del diagrama): reporte.solicitado (flujo del admin: informe PDF + aviso). */
		reportesFanout: process.env.RABBITMQ_EXCHANGE_REPORTES_FANOUT ?? 'hotel.reportes.fanout',
		/** Direct: dead-letter exchange compartido por todas las colas del sistema. */
		deadLetter: process.env.RABBITMQ_EXCHANGE_DLX ?? 'hotel.dlx'
	},

	routingKeys: {
		reservaCreada: 'reserva.creada',
		reporteSolicitado: 'reporte.solicitado',
		/** Mensajes que el broker devolvió por no tener cola destino (publish mandatory). */
		noEntregado: 'mensaje.no-entregado'
	},

	queues: {
		/** DLQ única del sistema: también recibe lo que este productor no pudo entregar. */
		dlq: process.env.RABBITMQ_QUEUE_DLQ ?? 'hotel.dlq'
	}
} as const;

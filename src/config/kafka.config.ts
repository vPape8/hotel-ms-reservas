// Configuración centralizada de Kafka (equivalente a spring.kafka en application.yml + KafkaConfig del demo).
// Nombres de tópicos, particiones, réplicas y configuraciones se leen solo de aquí.
// Deben coincidir con los consumidores (hotel-ms-reportes, hotel-ms-auditoria) y con hotel-ms-kafka-admin.

const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;
const CATORCE_DIAS_MS = 14 * 24 * 60 * 60 * 1000;

export interface DefinicionTopico {
	nombre: string;
	particiones: number;
	replicas: number;
	configs: Record<string, string>;
}

function lista(variable: string | undefined): string[] {
	return (variable ?? '').split(',').map((valor) => valor.trim()).filter(Boolean);
}

export const kafkaConfig = {
	/** bootstrap-servers. Si está vacío, Kafka queda desactivado (tests y desarrollo sin brokers). */
	brokers: lista(process.env.KAFKA_BROKERS),
	clientId: process.env.KAFKA_CLIENT_ID ?? 'hotel-ms-reservas',
	reconexionMs: Number(process.env.KAFKA_RECONEXION_MS ?? 10000),

	productor: {
		/** acks=all: el broker responde cuando todas las réplicas en sincronía (mínimo 2) guardaron el evento. */
		acks: -1,
		/** No duplica el evento si el envío se reintenta por un corte de red. */
		idempotente: true,
		reintentos: 5
	},

	topicos: {
		/**
		 * Historial del ciclo de vida de las reservas. Key = idHabitacion: los eventos de una misma
		 * habitación caen en la misma partición y se leen en orden.
		 * delete + 7 días: es un historial, como "pedidos" en la guía 3.3.1.
		 */
		reservas: {
			nombre: process.env.KAFKA_TOPICO_RESERVAS ?? 'reservas',
			particiones: 3,
			replicas: 3,
			configs: {
				'cleanup.policy': 'delete',
				'retention.ms': String(SIETE_DIAS_MS),
				'min.insync.replicas': '2'
			}
		},
		/** Dead-letter topic: lo usan los consumidores cuando un evento falla (guía 3.3.3). Más retención para revisarlo. */
		reservasDlt: {
			nombre: process.env.KAFKA_TOPICO_RESERVAS_DLT ?? 'reservas.DLT',
			particiones: 3,
			replicas: 3,
			configs: {
				'cleanup.policy': 'delete',
				'retention.ms': String(CATORCE_DIAS_MS),
				'min.insync.replicas': '2'
			}
		}
	} satisfies Record<string, DefinicionTopico>
} as const;

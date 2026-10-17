import { Channel } from 'amqplib';
import { rabbitConfig } from './rabbitmq.config';

// Declaración de exchanges, colas y bindings que usa el productor (equivalente a los @Bean Queue/Exchange/Binding).
// RabbitMQ las crea solo si no existen, así que es seguro declararlas en cada conexión.

interface DefinicionExchange {
	nombre: string;
	tipo: 'direct' | 'topic' | 'fanout';
}

interface DefinicionCola {
	nombre: string;
}

interface DefinicionBinding {
	exchange: string;
	cola: string;
	routingKey: string;
}

export const topologiaReservas = {
	exchanges: [
		// Flujo del usuario: los consumidores se suscriben por routing key (reserva.creada).
		{ nombre: rabbitConfig.exchanges.reservas, tipo: 'topic' },
		// Flujo del admin: fanout, cada cola enlazada recibe una copia de reporte.solicitado.
		{ nombre: rabbitConfig.exchanges.reportesFanout, tipo: 'fanout' },
		// Dead-letter exchange compartido: todo termina en la DLQ única hotel.dlq.
		{ nombre: rabbitConfig.exchanges.deadLetter, tipo: 'direct' }
	] satisfies DefinicionExchange[],

	colas: [
		// DLQ única: aquí van los mensajes devueltos por el broker al publicar (sin cola destino).
		{ nombre: rabbitConfig.queues.dlq }
	] satisfies DefinicionCola[],

	bindings: [
		{
			exchange: rabbitConfig.exchanges.deadLetter,
			cola: rabbitConfig.queues.dlq,
			routingKey: rabbitConfig.routingKeys.noEntregado
		}
	] satisfies DefinicionBinding[]
};

export async function declararTopologia(canal: Channel): Promise<void> {
	for (const exchange of topologiaReservas.exchanges) {
		await canal.assertExchange(exchange.nombre, exchange.tipo, { durable: true });
	}
	for (const cola of topologiaReservas.colas) {
		await canal.assertQueue(cola.nombre, { durable: true });
	}
	for (const binding of topologiaReservas.bindings) {
		await canal.bindQueue(binding.cola, binding.exchange, binding.routingKey);
	}
}

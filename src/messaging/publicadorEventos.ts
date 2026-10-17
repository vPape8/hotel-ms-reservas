import amqp, { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { IReserva } from '../config/models/IReserva';
import { ISolicitudReporte } from '../config/models/reportes/ISolicitudReporte';
import { rabbitConfig } from '../config/rabbitmq.config';
import { declararTopologia } from '../config/rabbitmq.topology';
import { crearEvento, EventoDominio, reservaParaPublicar } from './eventos';
import { logMensajeria } from './logMensajeria';

/** Lo único que conoce la lógica de negocio: no sabe de exchanges, colas ni routing keys. */
export interface PublicadorEventos {
	publicarReservaCreada(reserva: IReserva): Promise<void>;
	publicarReporteSolicitado(solicitud: ISolicitudReporte): Promise<string>;
	cerrar(): Promise<void>;
}

/** Se usa cuando RABBITMQ_URL no está definida (tests, desarrollo sin broker): solo deja registro. */
export class PublicadorDesactivado implements PublicadorEventos {
	async publicarReservaCreada(reserva: IReserva): Promise<void> {
		logMensajeria('warn', 'MENSAJERIA_DESACTIVADA', { tipo: rabbitConfig.routingKeys.reservaCreada, codigo: reserva.codigo });
	}

	async publicarReporteSolicitado(solicitud: ISolicitudReporte): Promise<string> {
		const evento = crearEvento(rabbitConfig.routingKeys.reporteSolicitado, solicitud);
		logMensajeria('warn', 'MENSAJERIA_DESACTIVADA', { tipo: evento.tipo, id: evento.id });
		return evento.id;
	}

	async cerrar(): Promise<void> {}
}

export class PublicadorRabbit implements PublicadorEventos {
	private conexion?: amqp.ChannelModel;
	private canal?: ConfirmChannel;
	private conectando?: Promise<ConfirmChannel>;

	constructor(private readonly url: string) {}

	async publicarReservaCreada(reserva: IReserva): Promise<void> {
		await this.publicar(rabbitConfig.exchanges.reservas, crearEvento(rabbitConfig.routingKeys.reservaCreada, reservaParaPublicar(reserva)));
	}

	async publicarReporteSolicitado(solicitud: ISolicitudReporte): Promise<string> {
		const evento = crearEvento(rabbitConfig.routingKeys.reporteSolicitado, solicitud);
		await this.publicar(rabbitConfig.exchanges.reportesFanout, evento);
		return evento.id;
	}

	async cerrar(): Promise<void> {
		const conexion = this.conexion;
		this.conexion = undefined;
		this.canal = undefined;
		await conexion?.close().catch(() => undefined);
	}

	/**
	 * Publica con confirmación del broker (publisher confirms) y mandatory=true:
	 * - si el broker no confirma, se registra en el log como NO_PUBLICADO y se propaga el error;
	 * - si no hay cola para la routing key, el broker lo devuelve y termina en la DLQ (hotel.dlq).
	 */
	private async publicar<T>(exchange: string, evento: EventoDominio<T>): Promise<void> {
		const contenido = Buffer.from(JSON.stringify(evento));

		try {
			const canal = await this.obtenerCanal();
			await new Promise<void>((resolve, reject) => {
				// En el fanout la routing key se ignora; se envía igual para que quede registrada en el mensaje.
				canal.publish(exchange, evento.tipo, contenido, {
					persistent: true,
					mandatory: true,
					contentType: 'application/json',
					messageId: evento.id,
					type: evento.tipo,
					timestamp: Date.now(),
					appId: evento.origen
				}, (error) => (error ? reject(error) : resolve()));
			});
			logMensajeria('info', 'MENSAJE_PUBLICADO', { exchange, tipo: evento.tipo, id: evento.id });
		} catch (error) {
			logMensajeria('error', 'MENSAJE_NO_PUBLICADO', {
				tipo: evento.tipo,
				id: evento.id,
				motivo: error instanceof Error ? error.message : String(error)
			});
			throw error;
		}
	}

	private obtenerCanal(): Promise<ConfirmChannel> {
		if (this.canal) {
			return Promise.resolve(this.canal);
		}
		this.conectando ??= this.conectar().finally(() => {
			this.conectando = undefined;
		});
		return this.conectando;
	}

	private async conectar(): Promise<ConfirmChannel> {
		const conexion = await amqp.connect(this.url);
		conexion.on('error', (error: Error) => logMensajeria('error', 'CONEXION_ERROR', { motivo: error.message }));
		conexion.on('close', () => {
			this.conexion = undefined;
			this.canal = undefined;
			logMensajeria('warn', 'CONEXION_CERRADA', { detalle: 'Se reconectará en la próxima publicación' });
		});

		const canal = await conexion.createConfirmChannel();
		canal.on('error', (error: Error) => logMensajeria('error', 'CANAL_ERROR', { motivo: error.message }));
		canal.on('close', () => {
			this.canal = undefined;
		});
		canal.on('return', (mensaje: ConsumeMessage) => this.enviarANoEntregados(canal, mensaje));

		await declararTopologia(canal);
		this.conexion = conexion;
		this.canal = canal;
		logMensajeria('info', 'CONEXION_ESTABLECIDA', { exchanges: [rabbitConfig.exchanges.reservas, rabbitConfig.exchanges.reportesFanout] });
		return canal;
	}

	/** Mensaje devuelto por el broker (sin cola destino): se registra y se guarda en la DLQ (hotel.dlq). */
	private enviarANoEntregados(canal: ConfirmChannel, mensaje: ConsumeMessage): void {
		const datos = {
			id: mensaje.properties.messageId,
			exchange: mensaje.fields.exchange,
			routingKey: mensaje.fields.routingKey
		};
		logMensajeria('error', 'MENSAJE_NO_ENTREGADO', datos);

		canal.publish(rabbitConfig.exchanges.deadLetter, rabbitConfig.routingKeys.noEntregado, mensaje.content, {
			...mensaje.properties,
			persistent: true,
			headers: {
				...mensaje.properties.headers,
				'x-motivo': 'SIN_COLA_DESTINO',
				'x-exchange-original': datos.exchange,
				'x-routing-key-original': datos.routingKey
			}
		}, (error) => {
			if (error) {
				logMensajeria('error', 'MENSAJE_PERDIDO', { ...datos, motivo: error.message });
			}
		});
	}
}

export function crearPublicadorEventos(): PublicadorEventos {
	return rabbitConfig.url ? new PublicadorRabbit(rabbitConfig.url) : new PublicadorDesactivado();
}

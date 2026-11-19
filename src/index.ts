import { crearApp } from './app';
import { crearProductorEventosReserva } from './messaging/kafka/productorEventosReserva';
import { crearPublicadorEventos } from './messaging/publicadorEventos';

const puerto = Number(process.env.PORT ?? 8081);
const publicador = crearPublicadorEventos();
const productorKafka = crearProductorEventosReserva();

const servidor = crearApp({ publicador, productorKafka }).listen(puerto, () => {
	console.log(`hotel-ms-reservas escuchando en el puerto ${puerto}`);
	// Crea los tópicos y conecta el productor; si Kafka todavía no está listo, reintenta solo.
	void productorKafka.iniciar();
});

for (const senal of ['SIGINT', 'SIGTERM'] as const) {
	process.once(senal, () => {
		servidor.close();
		void Promise.all([publicador.cerrar(), productorKafka.cerrar()]).finally(() => process.exit(0));
	});
}

import { crearApp } from './app';
import { crearPublicadorEventos } from './messaging/publicadorEventos';

const puerto = Number(process.env.PORT ?? 8081);
const publicador = crearPublicadorEventos();

const servidor = crearApp(publicador).listen(puerto, () => {
	console.log(`hotel-ms-reservas escuchando en el puerto ${puerto}`);
});

for (const senal of ['SIGINT', 'SIGTERM'] as const) {
	process.once(senal, () => {
		servidor.close();
		void publicador.cerrar().finally(() => process.exit(0));
	});
}

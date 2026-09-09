import { crearApp } from './app';

const puerto = Number(process.env.PORT ?? 8081);

crearApp().listen(puerto, () => {
	console.log(`hotel-ms-reservas escuchando en el puerto ${puerto}`);
});
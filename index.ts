import { validarReserva } from './src/config/models/reservas/validarReserva';
import { crearApp } from './src/app';

export { validarReserva };

const puerto = 8083;
crearApp().listen(puerto, () => {
	console.log(`hotel-ms-reservas escuchando en el puerto ${puerto}`);
});

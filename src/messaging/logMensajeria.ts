type Nivel = 'info' | 'warn' | 'error';

/** Log estructurado (una línea JSON) para seguir los mensajes en `docker compose logs`. */
export function logMensajeria(nivel: Nivel, evento: string, datos: Record<string, unknown> = {}): void {
	const linea = JSON.stringify({ fecha: new Date().toISOString(), servicio: 'hotel-ms-reservas', nivel, evento, ...datos });
	if (nivel === 'error') {
		console.error(linea);
	} else if (nivel === 'warn') {
		console.warn(linea);
	} else {
		console.log(linea);
	}
}

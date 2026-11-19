import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { Pool } from 'mysql2/promise';
import { CanalReserva, EstadoReserva, IReserva } from '../config/models/IReserva';

export interface FiltrosReserva {
	estado?: EstadoReserva;
	idHabitacion?: string;
	email?: string;
	/** Dueño de la reserva: el sub de Cognito del cliente ("Mis reservas"). */
	creadaPor?: string;
	/** Fecha de entrada desde (inclusive). */
	desde?: Date;
	/** Fecha de entrada hasta (inclusive). */
	hasta?: Date;
	pagina: number;
	tamano: number;
}

export interface PaginaReservas {
	reservas: IReserva[];
	total: number;
}

export interface ReservaRepository {
	crear(reserva: IReserva): Promise<IReserva>;
	buscarPorId(id: string): Promise<IReserva | undefined>;
	buscarPorCodigo(codigo: string): Promise<IReserva | undefined>;
	listar(filtros: FiltrosReserva): Promise<PaginaReservas>;
	actualizarEstado(id: string, estado: EstadoReserva): Promise<IReserva | undefined>;
}

function cumpleFiltros(reserva: IReserva, filtros: FiltrosReserva): boolean {
	return (!filtros.estado || reserva.estado === filtros.estado)
		&& (!filtros.idHabitacion || reserva.idHabitacion === filtros.idHabitacion)
		&& (!filtros.email || reserva.huesped.email.toLowerCase() === filtros.email.toLowerCase())
		&& (!filtros.creadaPor || reserva.creadaPor === filtros.creadaPor)
		&& (!filtros.desde || reserva.fechaEntrada >= filtros.desde)
		&& (!filtros.hasta || reserva.fechaEntrada <= filtros.hasta);
}

/** Para tests y desarrollo sin MySQL. */
export class InMemoryReservaRepository implements ReservaRepository {
	readonly reservas = new Map<string, IReserva>();

	async crear(reserva: IReserva): Promise<IReserva> {
		this.reservas.set(reserva.id!, reserva);
		return reserva;
	}

	async buscarPorId(id: string): Promise<IReserva | undefined> {
		return this.reservas.get(id);
	}

	async buscarPorCodigo(codigo: string): Promise<IReserva | undefined> {
		return [...this.reservas.values()].find((reserva) => reserva.codigo === codigo);
	}

	async listar(filtros: FiltrosReserva): Promise<PaginaReservas> {
		const todas = [...this.reservas.values()]
			.filter((reserva) => cumpleFiltros(reserva, filtros))
			.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
		const inicio = (filtros.pagina - 1) * filtros.tamano;
		return { reservas: todas.slice(inicio, inicio + filtros.tamano), total: todas.length };
	}

	async actualizarEstado(id: string, estado: EstadoReserva): Promise<IReserva | undefined> {
		const actual = this.reservas.get(id);
		if (!actual) return undefined;
		const actualizada = { ...actual, estado, updatedAt: new Date() };
		this.reservas.set(id, actualizada);
		return actualizada;
	}
}

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS reservas (
	id CHAR(36) PRIMARY KEY,
	codigo VARCHAR(64) NOT NULL UNIQUE,
	id_habitacion VARCHAR(64) NOT NULL,
	huesped_nombre VARCHAR(100) NOT NULL,
	huesped_apellido VARCHAR(100) NOT NULL,
	huesped_email VARCHAR(255) NOT NULL,
	huesped_telefono VARCHAR(30) NULL,
	fecha_entrada DATETIME(3) NOT NULL,
	fecha_salida DATETIME(3) NOT NULL,
	cantidad_huespedes INT NOT NULL,
	estado ENUM('PENDIENTE', 'CONFIRMADA', 'CANCELADA', 'COMPLETADA') NOT NULL,
	precio_por_noche DECIMAL(12, 2) NOT NULL,
	precio_total DECIMAL(12, 2) NOT NULL,
	observaciones VARCHAR(500) NULL,
	creada_por VARCHAR(255) NOT NULL,
	canal VARCHAR(30) NOT NULL,
	created_at DATETIME(3) NOT NULL,
	updated_at DATETIME(3) NOT NULL,
	INDEX idx_reservas_estado (estado),
	INDEX idx_reservas_fecha_entrada (fecha_entrada),
	INDEX idx_reservas_email (huesped_email)
)`;

interface ReservaRow extends RowDataPacket {
	id: string;
	codigo: string;
	id_habitacion: string;
	huesped_nombre: string;
	huesped_apellido: string;
	huesped_email: string;
	huesped_telefono: string | null;
	fecha_entrada: Date;
	fecha_salida: Date;
	cantidad_huespedes: number;
	estado: EstadoReserva;
	precio_por_noche: string;
	precio_total: string;
	observaciones: string | null;
	creada_por: string;
	canal: CanalReserva;
	created_at: Date;
	updated_at: Date;
}

interface ConteoRow extends RowDataPacket {
	total: number;
}

function aReserva(fila: ReservaRow): IReserva {
	return {
		id: fila.id,
		codigo: fila.codigo,
		idHabitacion: fila.id_habitacion,
		huesped: {
			nombre: fila.huesped_nombre,
			apellido: fila.huesped_apellido,
			email: fila.huesped_email,
			telefono: fila.huesped_telefono ?? undefined
		},
		fechaEntrada: fila.fecha_entrada,
		fechaSalida: fila.fecha_salida,
		cantidadHuespedes: fila.cantidad_huespedes,
		estado: fila.estado,
		precioPorNoche: Number(fila.precio_por_noche),
		precioTotal: Number(fila.precio_total),
		observaciones: fila.observaciones ?? undefined,
		creadaPor: fila.creada_por,
		canal: fila.canal,
		createdAt: fila.created_at,
		updatedAt: fila.updated_at
	};
}

export class MySqlReservaRepository implements ReservaRepository {
	private esquemaListo?: Promise<void>;

	constructor(private readonly pool: Pool) {}

	/** La tabla se crea sola la primera vez, aunque el volumen de MySQL ya exista. */
	private asegurarEsquema(): Promise<void> {
		this.esquemaListo ??= this.pool.query(ESQUEMA).then(() => undefined).catch((error: unknown) => {
			this.esquemaListo = undefined;
			throw error;
		});
		return this.esquemaListo;
	}

	async crear(reserva: IReserva): Promise<IReserva> {
		await this.asegurarEsquema();
		await this.pool.execute<ResultSetHeader>(
			`INSERT INTO reservas (id, codigo, id_habitacion, huesped_nombre, huesped_apellido, huesped_email, huesped_telefono,
				fecha_entrada, fecha_salida, cantidad_huespedes, estado, precio_por_noche, precio_total, observaciones,
				creada_por, canal, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				reserva.id!, reserva.codigo, reserva.idHabitacion, reserva.huesped.nombre, reserva.huesped.apellido,
				reserva.huesped.email, reserva.huesped.telefono ?? null, reserva.fechaEntrada, reserva.fechaSalida,
				reserva.cantidadHuespedes, reserva.estado, reserva.precioPorNoche, reserva.precioTotal,
				reserva.observaciones ?? null, reserva.creadaPor ?? 'invitado', reserva.canal ?? 'WEB_HUESPEDES',
				reserva.createdAt ?? new Date(), reserva.updatedAt ?? new Date()
			]
		);
		return reserva;
	}

	async buscarPorId(id: string): Promise<IReserva | undefined> {
		await this.asegurarEsquema();
		const [filas] = await this.pool.query<ReservaRow[]>('SELECT * FROM reservas WHERE id = ?', [id]);
		return filas[0] ? aReserva(filas[0]) : undefined;
	}

	async buscarPorCodigo(codigo: string): Promise<IReserva | undefined> {
		await this.asegurarEsquema();
		const [filas] = await this.pool.query<ReservaRow[]>('SELECT * FROM reservas WHERE codigo = ?', [codigo]);
		return filas[0] ? aReserva(filas[0]) : undefined;
	}

	async listar(filtros: FiltrosReserva): Promise<PaginaReservas> {
		await this.asegurarEsquema();
		const condiciones: string[] = [];
		const valores: unknown[] = [];
		if (filtros.estado) { condiciones.push('estado = ?'); valores.push(filtros.estado); }
		if (filtros.idHabitacion) { condiciones.push('id_habitacion = ?'); valores.push(filtros.idHabitacion); }
		if (filtros.email) { condiciones.push('LOWER(huesped_email) = LOWER(?)'); valores.push(filtros.email); }
		if (filtros.creadaPor) { condiciones.push('creada_por = ?'); valores.push(filtros.creadaPor); }
		if (filtros.desde) { condiciones.push('fecha_entrada >= ?'); valores.push(filtros.desde); }
		if (filtros.hasta) { condiciones.push('fecha_entrada <= ?'); valores.push(filtros.hasta); }
		const donde = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';

		const [[conteo]] = await this.pool.query<ConteoRow[]>(`SELECT COUNT(*) AS total FROM reservas ${donde}`, valores);
		const [filas] = await this.pool.query<ReservaRow[]>(
			`SELECT * FROM reservas ${donde} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
			[...valores, filtros.tamano, (filtros.pagina - 1) * filtros.tamano]
		);
		return { reservas: filas.map(aReserva), total: Number(conteo?.total ?? 0) };
	}

	async actualizarEstado(id: string, estado: EstadoReserva): Promise<IReserva | undefined> {
		await this.asegurarEsquema();
		const [resultado] = await this.pool.execute<ResultSetHeader>(
			'UPDATE reservas SET estado = ?, updated_at = ? WHERE id = ?',
			[estado, new Date(), id]
		);
		return resultado.affectedRows > 0 ? this.buscarPorId(id) : undefined;
	}
}

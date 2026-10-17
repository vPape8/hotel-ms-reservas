export interface ISolicitudReporte {
	/** Fecha ISO (YYYY-MM-DD) desde la que se consideran las reservas, por fecha de entrada. */
	desde: string;
	/** Fecha ISO (YYYY-MM-DD) hasta la que se consideran las reservas, inclusive. */
	hasta: string;
	/** Administrador que recibe el informe en PDF. */
	solicitadoPor: {
		nombre?: string;
		email: string;
	};
}

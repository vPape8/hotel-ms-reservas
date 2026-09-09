import { Request, Response } from 'express';

export function meController(solicitud: Request, respuesta: Response): void {
	respuesta.status(200).json({ claims: solicitud.user });
}
import { z } from 'zod';

/**
 * Esquemas del modulo de tarifas.
 *
 * El costo de un envio se calcula con tres datos:
 * Departamento de Origen, Departamento de Destino y Peso en Libras.
 * El cliente indica el peso; el sistema deriva el resto.
 */

/** Peso minimo que se COBRA: la tarifa base ya incluye estas libras. */
export const MIN_WEIGHT_LBS = 2;
/** Peso maximo aceptado (libras). */
export const MAX_WEIGHT_LBS = 50;
/**
 * Peso minimo que se ACEPTA en el formulario. Es menor que el minimo
 * cobrado a proposito: un paquete de menos de 2 lb se registra igual y
 * se cobra como 2 lb, con un aviso al cliente.
 */
export const MIN_INPUT_WEIGHT_LBS = 0.1;

/** Cuerpo para previsualizar el costo antes de crear el envio. */
export const calculateRateSchema = z.object({
  originDepartmentId: z.string().uuid('Selecciona el departamento de origen'),
  destDepartmentId: z.string().uuid('Selecciona el departamento de destino'),
  weightLbs: z.coerce
    .number()
    .min(MIN_INPUT_WEIGHT_LBS, 'Indica el peso del paquete en libras')
    .max(MAX_WEIGHT_LBS, `El peso no puede superar las ${MAX_WEIGHT_LBS} libras`),
});

export type CalculateRateInput = z.infer<typeof calculateRateSchema>;

/** Alta/edicion de tarifas (solo ADMIN/OPERATOR). */
export const shippingRateSchema = z.object({
  originDepartmentId: z.string().uuid(),
  destDepartmentId: z.string().uuid(),
  routeType: z.enum(['LOCAL', 'SHORT', 'MEDIUM', 'LONG']),
  baseAmountCents: z.number().int().min(0),
  includedLbs: z.number().positive().max(MAX_WEIGHT_LBS).default(MIN_WEIGHT_LBS),
  extraPerLbCents: z.number().int().min(0),
  deliveryCents: z.number().int().min(0).default(0),
  currency: z.string().trim().length(3).default('NIO'),
  isActive: z.boolean().default(true),
  priority: z.number().int().default(0),
  notes: z.string().trim().max(500).nullish(),
});

export const shippingRateUpdateSchema = shippingRateSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'No hay campos para actualizar',
);

export type ShippingRateInput = z.infer<typeof shippingRateSchema>;

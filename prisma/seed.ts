/**
 * SEED DE DESARROLLO
 * ==================
 *
 * Crea una base de datos de demostracion con datos coherentes entre si:
 * sucursales, departamentos, tarifas de envio, usuarios de cada rol y
 * envios en distintos estados de la maquina de estados (no todos los
 * envios empiezan igual).
 *
 * Dos propiedades importantes:
 *
 *  1. ES IDEMPOTENTE. Se puede ejecutar `npm run db:seed` las veces que
 *     haga falta: reejecutarlo actualiza los registros demo en vez de
 *     duplicarlos. Se identifica a los registros demo por el sufijo
 *     `@demo.hossana.local` y por los codigos de sucursal `DEMO-*`, nunca
 *     por su id, para que sobreviva a un reseteo de la base.
 *
 *  2. USA LOS MISMOS SERVICIOS QUE LA API. Los envios se crean con
 *     `createShipment` y avanzan con `applyStateChange`, de modo que el
 *     seed no puede producir datos que la API nunca produciria (eventos
 *     fuera de la maquina de estados, secuencias rotas, QR sin firmar).
 *     Si el seed pasa, las invariantes del sistema son correctas.
 *
 * Las contrasenas demo cumplen la politica de contrasenas del sistema
 * (minimo 8 caracteres con mayuscula, minuscula, numero y caracter
 * especial) porque su unico proposito es desarrollo local. En produccion
 * este archivo nunca se ejecuta.
 */

import 'dotenv/config';
import type { PrismaClient, RouteType, UserRole } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/modules/auth/service.js';
import { issueOtp } from '../src/modules/auth/tokens.js';
import { createShipment, applyStateChange, deliverShipment } from '../src/modules/shipments/service.js';
import { encryptPII, blindIndex } from '../src/lib/crypto.js';
import { createShipmentSchema } from '../src/modules/shipments/schema.js';

/**
 * Tipo de ENTRADA del esquema (con opcionales y defaults sin aplicar).
 * El seed escribe datos a mano y omite campos como `isFragile` o
 * `currency`; `createShipmentSchema.parse` los rellena igual que lo
 * haria la API, asi que el seed no puede saltarse una validacion.
 */
type ShipmentSeedInput = z.input<typeof createShipmentSchema>;
type AddressSeedInput = ShipmentSeedInput['senderAddress'];
type ItemSeedInput = NonNullable<ShipmentSeedInput['items']>[number];

const DEMO_PASSWORD = 'Demo123!';
const DEMO_DOMAIN = 'demo.hossana.local';

// ── Utilidades de consola ──────────────────────────────────────

function heading(title: string): void {
  process.stdout.write(`\n\x1b[1m${title}\x1b[0m\n${'─'.repeat(title.length)}\n`);
}

function ok(message: string): void {
  process.stdout.write(`  \x1b[32m✓\x1b[0m ${message}\n`);
}

function info(message: string): void {
  process.stdout.write(`  \x1b[90m·\x1b[0m ${message}\n`);
}

// ── Helpers de datos ───────────────────────────────────────────

/** Upsert por una clave natural (correo), que sobrevive a un reseteo. */
async function upsertUser(
  data: {
    email: string;
    firstName: string;
    lastName: string;
    password: string;
    phone?: string;
    roles: UserRole[];
    status?: 'ACTIVE' | 'PENDING_VERIFICATION' | 'SUSPENDED';
    locale?: string;
  },
): Promise<{ id: string; email: string }> {
  const passwordHash = await hashPassword(data.password);

  const user = await prisma.user.upsert({
    where: { email: data.email },
    create: {
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      passwordHash,
      phoneCipher: data.phone ? encryptPII(data.phone) : null,
      phoneHash: data.phone ? blindIndex(data.phone) : null,
      roles: data.roles,
      status: data.status ?? 'ACTIVE',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: data.phone ? new Date() : null,
    },
    update: {
      firstName: data.firstName,
      lastName: data.lastName,
      passwordHash,
      phoneCipher: data.phone ? encryptPII(data.phone) : null,
      phoneHash: data.phone ? blindIndex(data.phone) : null,
      roles: data.roles,
      status: data.status ?? 'ACTIVE',
    },
    select: { id: true, email: true },
  });

  return user;
}

interface BranchSeed {
  code: string;
  name: string;
  city: string;
  addressLine: string;
  latitude: number;
  longitude: number;
}

const BRANCHES: BranchSeed[] = [
  {
    code: 'DEMO-MGA',
    name: 'Centro de distribucion Managua',
    city: 'Managua',
    addressLine: 'Av. Bolivar 1200, frente a la UCA',
    latitude: 12.115,
    longitude: -86.2362,
  },
  {
    code: 'DEMO-LEO',
    name: 'Centro de distribucion Leon',
    city: 'Leon',
    addressLine: 'Av. Central 452, dos cuadras al norte del parque',
    latitude: 12.4379,
    longitude: -86.8781,
  },
  {
    code: 'DEMO-GRA',
    name: 'Centro de distribucion Granada',
    city: 'Granada',
    addressLine: 'Calle La Calzada 310, costado este del parque',
    latitude: 11.9291,
    longitude: -85.956,
  },
  {
    code: 'DEMO-EST',
    name: 'Centro de distribucion Esteli',
    city: 'Esteli',
    addressLine: 'Av. 16 de Julio 890',
    latitude: 13.0918,
    longitude: -86.3554,
  },
  {
    code: 'DEMO-CHN',
    name: 'Centro de distribucion Chinandega',
    city: 'Chinandega',
    addressLine: 'Av. 14 de Septiembre 210',
    latitude: 12.6293,
    longitude: -87.1272,
  },
];

// ── Departamentos y tarifas ────────────────────────────────────
//
// El costo de un envio se calcula con tres datos: departamento de
// origen, departamento de destino y peso en libras. Hay 5
// departamentos cubiertos y una tarifa por cada par origen-destino
// (5 x 5 = 25 tarifas).

interface DepartmentSeed {
  code: string;
  name: string;
  sortOrder: number;
}

const DEPARTMENTS: DepartmentSeed[] = [
  { code: 'MAN', name: 'Managua', sortOrder: 1 },
  { code: 'LEO', name: 'León', sortOrder: 2 },
  { code: 'EST', name: 'Estelí', sortOrder: 3 },
  { code: 'GRA', name: 'Granada', sortOrder: 4 },
  { code: 'CHI', name: 'Chinandega', sortOrder: 5 },
];

/** Sucursal demo -> departamento al que pertenece. */
const BRANCH_DEPARTMENT: Record<string, string> = {
  'DEMO-MGA': 'MAN',
  'DEMO-LEO': 'LEO',
  'DEMO-EST': 'EST',
  'DEMO-GRA': 'GRA',
  'DEMO-CHN': 'CHI',
};

/**
 * Categoria de la ruta para cada par origen -> destino. La categoria
 * determina la tarifa base, el costo por libra adicional y el delivery.
 */
const ROUTE_TYPE_MATRIX: Record<string, Record<string, RouteType>> = {
  MAN: { MAN: 'LOCAL', LEO: 'SHORT', EST: 'MEDIUM', GRA: 'SHORT', CHI: 'MEDIUM' },
  LEO: { MAN: 'SHORT', LEO: 'LOCAL', EST: 'MEDIUM', GRA: 'MEDIUM', CHI: 'SHORT' },
  EST: { MAN: 'MEDIUM', LEO: 'MEDIUM', EST: 'LOCAL', GRA: 'LONG', CHI: 'MEDIUM' },
  GRA: { MAN: 'SHORT', LEO: 'MEDIUM', EST: 'LONG', GRA: 'LOCAL', CHI: 'LONG' },
  CHI: { MAN: 'MEDIUM', LEO: 'SHORT', EST: 'MEDIUM', GRA: 'LONG', CHI: 'LOCAL' },
};

/**
 * Tarifario vigente (en centavos de cordoba, NIO). La tarifa base
 * incluye las primeras 2 libras; a partir de ahi se cobra por libra
 * adicional redondeada hacia arriba. El delivery es fijo por categoria.
 */
const ROUTE_TARIFFS: Record<RouteType, { baseAmountCents: number; extraPerLbCents: number; deliveryCents: number }> = {
  LOCAL: { baseAmountCents: 6_000, extraPerLbCents: 1_000, deliveryCents: 0 },
  SHORT: { baseAmountCents: 9_000, extraPerLbCents: 1_500, deliveryCents: 4_000 },
  MEDIUM: { baseAmountCents: 13_000, extraPerLbCents: 2_000, deliveryCents: 5_000 },
  LONG: { baseAmountCents: 18_000, extraPerLbCents: 2_500, deliveryCents: 7_000 },
};

async function seedDepartments(): Promise<Record<string, string>> {
  heading('Departamentos');

  const ids: Record<string, string> = {};

  for (const department of DEPARTMENTS) {
    const row = await prisma.department.upsert({
      where: { code: department.code },
      create: {
        code: department.code,
        name: department.name,
        countryCode: 'NI',
        sortOrder: department.sortOrder,
      },
      update: {
        name: department.name,
        countryCode: 'NI',
        sortOrder: department.sortOrder,
        isActive: true,
      },
      select: { id: true },
    });

    ids[department.code] = row.id;
    ok(`${department.code} · ${department.name}`);
  }

  return ids;
}

/**
 * Cuentas bancarias para transferencias manuales. Son datos reales del
 * negocio, no demo: se actualizan por codigo y no se borran.
 */
async function seedBankAccounts(): Promise<void> {
  heading('Cuentas bancarias');

  const accounts = [
    {
      currency: 'NIO',
      accountNumber: '133095030',
      sortOrder: 1,
    },
    {
      currency: 'USD',
      accountNumber: '130286611',
      sortOrder: 2,
    },
  ];

  for (const account of accounts) {
    await prisma.bankAccount.upsert({
      where: {
        currency_accountNumber: {
          currency: account.currency,
          accountNumber: account.accountNumber,
        },
      },
      create: {
        currency: account.currency,
        bankName: 'Banco Lafise',
        accountName: 'Marcos Amador',
        accountNumber: account.accountNumber,
        accountType: 'CUENTA_CORRIENTE',
        isActive: true,
        sortOrder: account.sortOrder,
      },
      update: {
        bankName: 'Banco Lafise',
        accountName: 'Marcos Amador',
        accountType: 'CUENTA_CORRIENTE',
        isActive: true,
        sortOrder: account.sortOrder,
      },
    });
    ok(`${account.currency} · ${account.accountNumber} · Banco Lafise`);
  }
}

async function seedShippingRates(departmentIds: Record<string, string>): Promise<void> {
  heading('Tarifas de envio');

  let count = 0;

  for (const origin of DEPARTMENTS) {
    for (const dest of DEPARTMENTS) {
      const originId = departmentIds[origin.code];
      const destId = departmentIds[dest.code];
      if (!originId || !destId) continue;

      const routeType = ROUTE_TYPE_MATRIX[origin.code]?.[dest.code];
      if (!routeType) continue;

      const tariff = ROUTE_TARIFFS[routeType];

      await prisma.shippingRate.upsert({
        where: {
          originDepartmentId_destDepartmentId: {
            originDepartmentId: originId,
            destDepartmentId: destId,
          },
        },
        create: {
          originDepartmentId: originId,
          destDepartmentId: destId,
          routeType,
          baseAmountCents: tariff.baseAmountCents,
          includedLbs: 2,
          extraPerLbCents: tariff.extraPerLbCents,
          deliveryCents: tariff.deliveryCents,
          currency: 'NIO',
          isActive: true,
        },
        update: {
          routeType,
          baseAmountCents: tariff.baseAmountCents,
          includedLbs: 2,
          extraPerLbCents: tariff.extraPerLbCents,
          deliveryCents: tariff.deliveryCents,
          currency: 'NIO',
          isActive: true,
        },
        select: { id: true },
      });

      count += 1;
    }
  }

  ok(`${count} tarifas (${DEPARTMENTS.length} x ${DEPARTMENTS.length} pares origen-destino)`);
}

/**
 * Direcciones de ejemplo. `contactPhone` es PII: se cifra en reposo,
 * igual que en el flujo real de la API.
 */
const ADDRESSES = {
  managua: {
    contactName: 'Elena Vargas',
    contactPhone: '+50587001122',
    line1: 'Calle Colon 145, Edificio Aurorita, Depto 4B',
    city: 'Managua',
    region: 'Managua',
    postalCode: '11001',
    countryCode: 'NI',
    latitude: 12.1145,
    longitude: -86.2545,
  },
  leon: {
    contactName: 'Marco Villalba',
    contactPhone: '+50587012345',
    line1: 'Av. Central 8200, Barrio El Calvario, Casa 17',
    city: 'Leon',
    region: 'Leon',
    postalCode: '21000',
    countryCode: 'NI',
    latitude: 12.4379,
    longitude: -86.8781,
  },
  granada: {
    contactName: 'Rosa Quinones',
    contactPhone: '+50587023456',
    line1: 'Calle La Calzada 4560, Casa 22',
    city: 'Granada',
    region: 'Granada',
    postalCode: '43000',
    countryCode: 'NI',
    latitude: 11.9291,
    longitude: -85.956,
  },
  esteli: {
    contactName: 'Pedro Gutierrez',
    contactPhone: '+50587034567',
    line1: 'Av. 16 de Julio 2300, Lote 8',
    city: 'Esteli',
    region: 'Esteli',
    postalCode: '31000',
    countryCode: 'NI',
    latitude: 13.0918,
    longitude: -86.3554,
  },
  chinandega: {
    contactName: 'Marta Lopez',
    contactPhone: '+50587045678',
    line1: 'Av. 14 de Septiembre 650, Reparto El Rosario',
    city: 'Chinandega',
    region: 'Chinandega',
    postalCode: '25000',
    countryCode: 'NI',
    latitude: 12.6293,
    longitude: -87.1272,
  },
} satisfies Record<string, AddressSeedInput>;

/**
 * Ciudad de cada direccion -> su clave en `ADDRESSES`. Permite tomar la
 * direccion de origen a partir de la sucursal de la que sale el envio.
 */
const CITY_KEY_BY_NAME: Record<string, keyof typeof ADDRESSES> = Object.fromEntries(
  (Object.keys(ADDRESSES) as (keyof typeof ADDRESSES)[]).map((key) => [ADDRESSES[key].city, key]),
);

// ── Seed ───────────────────────────────────────────────────────

async function seedBranches(): Promise<Record<string, string>> {
  heading('Sucursales');

  const ids: Record<string, string> = {};

  for (const branch of BRANCHES) {
    const row = await prisma.branch.upsert({
      where: { code: branch.code },
      create: {
        code: branch.code,
        name: branch.name,
        city: branch.city,
        countryCode: 'NI',
        addressLine: branch.addressLine,
        latitude: branch.latitude,
        longitude: branch.longitude,
      },
      update: {
        name: branch.name,
        city: branch.city,
        addressLine: branch.addressLine,
        latitude: branch.latitude,
        longitude: branch.longitude,
        isActive: true,
      },
      select: { id: true },
    });

    ids[branch.code] = row.id;
    ok(`${branch.code} · ${branch.name}`);
  }

  return ids;
}

interface DemoUsers {
  admin: { id: string; email: string };
  operator: { id: string; email: string };
  courier: { id: string; email: string };
  alice: { id: string; email: string };
  bruno: { id: string; email: string };
  carla: { id: string; email: string };
}

async function seedUsers(): Promise<DemoUsers> {
  heading('Usuarios');

  const admin = await upsertUser({
    email: `admin@${DEMO_DOMAIN}`,
    firstName: 'Ana',
    lastName: 'Rojas',
    password: DEMO_PASSWORD,
    phone: '+50580000001',
    roles: ['ADMIN'],
  });
  ok(`ADMIN      · ${admin.email}`);

  const operator = await upsertUser({
    email: `operador@${DEMO_DOMAIN}`,
    firstName: 'Luis',
    lastName: 'Mamani',
    password: DEMO_PASSWORD,
    phone: '+50580000002',
    roles: ['OPERATOR'],
  });
  ok(`OPERATOR   · ${operator.email}`);

  const courier = await upsertUser({
    email: `repartidor@${DEMO_DOMAIN}`,
    firstName: 'Jorge',
    lastName: 'Salas',
    password: DEMO_PASSWORD,
    phone: '+50580000003',
    roles: ['COURIER'],
  });
  ok(`COURIER    · ${courier.email}`);

  const alice = await upsertUser({
    email: `alice@${DEMO_DOMAIN}`,
    firstName: 'Alice',
    lastName: 'Fernandez',
    password: DEMO_PASSWORD,
    phone: '+50581111111',
    roles: ['SENDER', 'RECIPIENT'],
  });
  ok(`USER       · ${alice.email}  (SENDER, RECIPIENT)`);

  const bruno = await upsertUser({
    email: `bruno@${DEMO_DOMAIN}`,
    firstName: 'Bruno',
    lastName: 'Cespedes',
    password: DEMO_PASSWORD,
    phone: '+50582222222',
    roles: ['SENDER', 'RECIPIENT'],
  });
  ok(`USER       · ${bruno.email}  (SENDER, RECIPIENT)`);

  const carla = await upsertUser({
    email: `carla@${DEMO_DOMAIN}`,
    firstName: 'Carla',
    lastName: 'Mendoza',
    password: DEMO_PASSWORD,
    phone: '+50583333333',
    roles: ['SENDER', 'RECIPIENT'],
  });
  ok(`USER       · ${carla.email}  (SENDER, RECIPIENT)`);

  // Un usuario sin verificar, para probar el flujo de verificacion.
  const pending = await upsertUser({
    email: `pendiente@${DEMO_DOMAIN}`,
    firstName: 'Diego',
    lastName: 'Rojas',
    password: DEMO_PASSWORD,
    roles: ['RECIPIENT'],
    status: 'PENDING_VERIFICATION',
  });
  ok(`PENDING    · ${pending.email}`);

  return { admin, operator, courier, alice, bruno, carla };
}

/** Borra envios demo previos para no acumular duplicados al reejecutar. */
async function clearDemoShipments(): Promise<number> {
  const demoEmails = [
    `alice@${DEMO_DOMAIN}`,
    `bruno@${DEMO_DOMAIN}`,
    `carla@${DEMO_DOMAIN}`,
  ];

  // Las claves de idempotencia sobreviven al borrado de envios; si no
  // se limpian, un replay devuelve un trackingCode que ya no existe.
  await prisma.idempotencyKey.deleteMany({
    where: {
      endpoint: 'POST /api/shipments',
      key: { startsWith: 'seed-' },
    },
  });

  const result = await prisma.shipment.deleteMany({
    where: { sender: { email: { in: demoEmails } } },
  });

  return result.count;
}

/** Estados por los que puede avanzar un envio en el seed. */
type SeedPathState =
  | 'AWAITING_PICKUP'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'AT_DISTRIBUTION_CENTER'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERY_ATTEMPTED'
  | 'ON_HOLD'
  | 'EXCEPTION';

interface ShipmentSeed {
  label: string;
  senderId: string;
  recipientId: string;
  originBranchId: string;
  destinationBranchId: string;
  /** Direccion de destino. Determina a que ciudad llega el paquete. */
  recipientCity: keyof typeof ADDRESSES;
  items: ItemSeedInput[];
  notes: string;
  /** Estados por los que pasa, en orden. El ultimo es el estado final. */
  path: SeedPathState[];
  /** Si el envio termina entregado con OTP confirmado por el receptor. */
  deliverWithOtp?: boolean;
  paymentMethod?: 'ON_DELIVERY' | 'BANK_TRANSFER';
  /** Peso facturable en libras. Si se omite, se deriva de los items. */
  weightLbs?: number;
}

const GRAMS_PER_LB = 453.59237;

/**
 * Deriva el peso facturable a partir del peso de los items: redondea
 * hacia arriba a un decimal y respeta el minimo de 2 libras que cobra
 * el tarifario.
 */
function deriveWeightLbs(items: ItemSeedInput[]): number {
  const grams = items.reduce(
    (sum, item) => sum + (item.weightGrams ?? 0) * (item.quantity ?? 1),
    0,
  );
  if (grams <= 0) return 2;
  const lbs = Math.ceil((grams / GRAMS_PER_LB) * 10) / 10;
  return Math.min(50, Math.max(2, lbs));
}

/**
 * Crea un envio y lo avanza por `path` usando el servicio real de
 * transiciones. Las fechas de los hitos se retroceden para que la
 * linea de tiempo parezca historica y no todo un instante en el mismo
 * segundo.
 */
async function seedShipment(
  seed: ShipmentSeed,
  senderCity: keyof typeof ADDRESSES,
  deptIds: { origin: string; dest: string },
  staffActor: { userId: string; roles: UserRole[] },
): Promise<string | null> {
  // Se valida con el mismo esquema que usa la API: si el seed define un
  // dato invalido, falla aqui y no despues en una transicion.
  const input = createShipmentSchema.parse({
    recipientId: seed.recipientId,
    senderAddress: ADDRESSES[senderCity],
    recipientAddress: ADDRESSES[seed.recipientCity],
    items: seed.items,
    originBranchId: seed.originBranchId,
    destinationBranchId: seed.destinationBranchId,
    originDepartmentId: deptIds.origin,
    destDepartmentId: deptIds.dest,
    weightLbs: seed.weightLbs ?? deriveWeightLbs(seed.items),
    notes: seed.notes,
    paymentMethod: seed.paymentMethod ?? 'ON_DELIVERY',
    // Semilla fija: reejecutar el seed devuelve el mismo envio en vez
    // de crear uno nuevo.
    idempotencyKey: `seed-${seed.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  });

  const created = await createShipment(seed.senderId, input);
  const shipmentId = (
    await prisma.shipment.findUniqueOrThrow({
      where: { trackingCode: created.trackingCode },
      select: { id: true },
    })
  ).id;

  // Retrocede los hitos: 6 horas entre cada uno, hacia atras desde ahora.
  const stepMs = 6 * 60 * 60 * 1000;
  let stepsAgo = seed.path.length + 1;

  for (const to of seed.path) {
    stepsAgo -= 1;
    await applyStateChange(shipmentId, {
      to,
      occurredAt: new Date(Date.now() - stepsAgo * stepMs),
      source: 'SYSTEM',
      title: undefined,
      description: undefined,
      // El seed crea datos de demostracion: no debe enviar correos.
      notify: false,
    });
  }

  if (seed.deliverWithOtp) {
    // El receptor emite su OTP y lo presenta: es la unica via por la que
    // el sistema acepta una entrega verificada.
    const otp = await issueOtp(seed.recipientId, shipmentId, 'DELIVERY_CONFIRMATION');
    info(`OTP de ${seed.label}: ${otp.code}`);

    await deliverShipment(
      created.trackingCode,
      staffActor,
      { otp: otp.code, photoUrls: [], unverifiedReason: undefined },
      undefined,
      { notify: false },
    );
  }

  return created.trackingCode;
}

async function seedShipments(
  users: DemoUsers,
  branchIds: Record<string, string>,
  departmentIds: Record<string, string>,
): Promise<void> {
  heading('Envios');

  // La entrega demo la registra el administrador: es staff y puede
  // cerrar el envio sin que este asignado a un repartidor concreto.
  const staffActor = { userId: users.admin.id, roles: ['ADMIN'] as UserRole[] };

  const removed = await clearDemoShipments();
  if (removed > 0) {
    info(`${removed} envio(s) demo previo(s) eliminado(s) para evitar duplicados`);
  }

  // La direccion del emisor se toma de la sucursal de ORIGEN del envio.
  // Antes estaba fijada siempre en Managua, y los envios que llegaban a
  // Managua chocaban con la validacion de la API: origen y destino no
  // pueden ser la misma direccion.
  const cityByBranchId = new Map<string, keyof typeof ADDRESSES>();
  for (const branch of BRANCHES) {
    const id = branchIds[branch.code];
    const key = CITY_KEY_BY_NAME[branch.city];
    if (id && key) cityByBranchId.set(id, key);
  }
  const senderCityOf = (originBranchId: string): keyof typeof ADDRESSES =>
    cityByBranchId.get(originBranchId) ?? 'managua';

  // Sucursal -> departamento: da los extremos de la ruta para calcular
  // la tarifa automatica de cada envio.
  const deptIdByBranchId = new Map<string, string>();
  for (const branch of BRANCHES) {
    const branchId = branchIds[branch.code];
    const deptCode = BRANCH_DEPARTMENT[branch.code];
    const deptId = deptCode ? departmentIds[deptCode] : undefined;
    if (branchId && deptId) deptIdByBranchId.set(branchId, deptId);
  }
  const deptIdsOf = (originBranchId: string, destinationBranchId: string) => ({
    origin: deptIdByBranchId.get(originBranchId) ?? departmentIds['MAN']!,
    dest: deptIdByBranchId.get(destinationBranchId) ?? departmentIds['MAN']!,
  });

  const seeds: ShipmentSeed[] = [
    {
      label: 'electronics-mga-leo',
      senderId: users.alice.id,
      recipientId: users.bruno.id,
      originBranchId: branchIds['DEMO-MGA']!,
      destinationBranchId: branchIds['DEMO-LEO']!,
      recipientCity: 'leon',
      notes: 'Vajilla de cocina, paquete fragile. Manipular con cuidado.',
      items: [
        { name: 'Juego de ollas antiadherentes', quantity: 1, unitValueCents: 45000, weightGrams: 3200, isFragile: true },
        { name: 'Cubiertos de acero (12 piezas)', quantity: 2, unitValueCents: 8000, weightGrams: 900 },
      ],
      path: ['AWAITING_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'AT_DISTRIBUTION_CENTER', 'OUT_FOR_DELIVERY'],
    },
    {
      label: 'documents-mga-gra',
      senderId: users.alice.id,
      recipientId: users.carla.id,
      originBranchId: branchIds['DEMO-MGA']!,
      destinationBranchId: branchIds['DEMO-GRA']!,
      recipientCity: 'granada',
      notes: 'Documentos legales, sin valor comercial.',
      items: [
        { name: 'Carpeta de contratos firmados', quantity: 1, unitValueCents: 0, weightGrams: 400 },
      ],
      path: ['AWAITING_PICKUP', 'PICKED_UP', 'IN_TRANSIT'],
    },
    {
      label: 'clothing-leo-mga',
      senderId: users.bruno.id,
      recipientId: users.alice.id,
      originBranchId: branchIds['DEMO-LEO']!,
      destinationBranchId: branchIds['DEMO-MGA']!,
      recipientCity: 'managua',
      notes: 'Ropa de temporada.',
      items: [
        { name: 'Chaqueta de jean', quantity: 1, unitValueCents: 12000, weightGrams: 1100 },
        { name: 'Camisetas de algodon', quantity: 4, unitValueCents: 3500, weightGrams: 250 },
      ],
      path: ['AWAITING_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'AT_DISTRIBUTION_CENTER', 'OUT_FOR_DELIVERY', 'DELIVERY_ATTEMPTED', 'OUT_FOR_DELIVERY'],
    },
    {
      label: 'medicine-chn-mga',
      senderId: users.carla.id,
      recipientId: users.alice.id,
      originBranchId: branchIds['DEMO-CHN']!,
      destinationBranchId: branchIds['DEMO-MGA']!,
      recipientCity: 'managua',
      notes: 'Medicamento con receta. Entrega solo a la persona registrada.',
      items: [
        { name: 'Caja de medicamento (receta)', quantity: 1, unitValueCents: 22000, weightGrams: 600 },
      ],
      paymentMethod: 'ON_DELIVERY',
      path: ['AWAITING_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'AT_DISTRIBUTION_CENTER', 'OUT_FOR_DELIVERY'],
    },
  ];

  for (const seed of seeds) {
    const code = await seedShipment(
      seed,
      senderCityOf(seed.originBranchId),
      deptIdsOf(seed.originBranchId, seed.destinationBranchId),
      staffActor,
    );
    if (code) ok(`${code} · ${seed.label}`);
  }

  // Un envio ya entregado y verificado con OTP: el caso de exito del
  // que el sistema entero depende.
  const delivered = await seedShipment({
    label: 'book-chn-gra',
    senderId: users.bruno.id,
    recipientId: users.carla.id,
    originBranchId: branchIds['DEMO-CHN']!,
    destinationBranchId: branchIds['DEMO-GRA']!,
    recipientCity: 'granada',
    notes: 'Libros, sin merchandise fragil.',
    items: [
      { name: 'Caja de libros (6 tomos)', quantity: 1, unitValueCents: 30000, weightGrams: 5200 },
    ],
    path: ['AWAITING_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'AT_DISTRIBUTION_CENTER', 'OUT_FOR_DELIVERY'],
    deliverWithOtp: true,
  }, senderCityOf(branchIds['DEMO-CHN']!), deptIdsOf(branchIds['DEMO-CHN']!, branchIds['DEMO-GRA']!), staffActor);
  if (delivered) ok(`${delivered} · book-chn-gra (entregado y verificado con OTP)`);

  // Un envio con incidencia, para que el panel no muestre siempre todo verde.
  const exception = await seedShipment({
    label: 'furniture-mga-est',
    senderId: users.carla.id,
    recipientId: users.bruno.id,
    originBranchId: branchIds['DEMO-MGA']!,
    destinationBranchId: branchIds['DEMO-EST']!,
    recipientCity: 'esteli',
    notes: 'Mueble desarmado. Requiere dos personas para la entrega.',
    items: [
      { name: 'Estanteria (desarmada, 3 bulones)', quantity: 1, unitValueCents: 55000, weightGrams: 18400, isFragile: true },
    ],
    path: ['AWAITING_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ON_HOLD'],
  }, senderCityOf(branchIds['DEMO-MGA']!), deptIdsOf(branchIds['DEMO-MGA']!, branchIds['DEMO-EST']!), staffActor);
  if (exception) ok(`${exception} · furniture-mga-est (en espera)`);

  // Resumen para comparar contra lo que muestra el panel.
  const byStatus = await prisma.shipment.groupBy({
    by: ['status'],
    _count: { _all: true },
    orderBy: { status: 'asc' },
  });

  info('Resumen por estado:');
  for (const row of byStatus) {
    process.stdout.write(`      ${row.status.padEnd(24)} ${row._count._all}\n`);
  }
}

// ── Punto de entrada ───────────────────────────────────────────

export async function main(client: PrismaClient = prisma): Promise<void> {
  void client;
  process.stdout.write('\x1b[1mHossana · seed de desarrollo\x1b[0m\n');

  const branchIds = await seedBranches();
  const departmentIds = await seedDepartments();
  await seedShippingRates(departmentIds);
  await seedBankAccounts();
  const users = await seedUsers();
  await seedShipments(users, branchIds, departmentIds);

  heading('Listo');
  process.stdout.write(`  Contrasena de todos los usuarios demo: \x1b[33m${DEMO_PASSWORD}\x1b[0m\n`);
  process.stdout.write('  Swagger:  http://localhost:3000/docs\n\n');
}

// Solo se ejecuta cuando se invoca directamente (`tsx prisma/seed.ts`),
// no cuando se importa desde un test.
const invokedDirectly = /(?:^|[\\/])prisma[\\/]seed\.(?:ts|js)$/.test(
  process.argv[1] ?? '',
);
if (invokedDirectly) {
  main()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (error: unknown) => {
      process.stderr.write(`\n\x1b[31mEl seed fallo:\x1b[0m ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      await prisma.$disconnect();
      process.exitCode = 1;
    });
}

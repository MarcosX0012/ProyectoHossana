import { prisma } from '../src/lib/prisma.js';

/**
 * Siembra SOLO las cuentas bancarias de transferencia. Se puede correr
 * sin tocar los datos demo: `npm run db:seed:banks`.
 */
const ACCOUNTS = [
  { currency: 'NIO', accountNumber: '133095030', sortOrder: 1 },
  { currency: 'USD', accountNumber: '130286611', sortOrder: 2 },
] as const;

async function main(): Promise<void> {
  for (const account of ACCOUNTS) {
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
    process.stdout.write(`OK ${account.currency} ${account.accountNumber}\n`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    await prisma.$disconnect();
    process.exitCode = 1;
  });

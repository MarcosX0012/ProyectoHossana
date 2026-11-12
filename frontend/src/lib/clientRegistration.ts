/**
 * Estado compartido del registro de clientes entre sus tres pantallas.
 *
 * El correo se guarda en `sessionStorage` (no en `localStorage`): solo
 * vive mientras la pestaña está abierta, que es exactamente lo que dura
 * el trámite de verificación.
 */
export const CLIENT_REG_EMAIL_KEY = 'hossana_client_reg_email';
export const CLIENT_REG_TOKEN_KEY = 'hossana_client_reg_token';

export function getClientRegEmail(): string | null {
  try {
    const value = sessionStorage.getItem(CLIENT_REG_EMAIL_KEY);
    return value && value.includes('@') ? value : null;
  } catch {
    return null;
  }
}

export function setClientRegEmail(email: string): void {
  try {
    sessionStorage.setItem(CLIENT_REG_EMAIL_KEY, email);
  } catch {
    // Sin sessionStorage (modo privado estricto) el flujo se reinicia.
  }
}

export function clearClientRegEmail(): void {
  try {
    sessionStorage.removeItem(CLIENT_REG_EMAIL_KEY);
    sessionStorage.removeItem(CLIENT_REG_TOKEN_KEY);
  } catch {
    // Nada que limpiar.
  }
}

/**
 * Token firmado que el backend entrega al verificar el OTP. Sin el no
 * se puede completar el registro: probar que quien llama controla el
 * correo, no solo que conoce la dirección. Vive en sessionStorage igual
 * que el correo: solo durante el trámite.
 */
export function getClientRegToken(): string | null {
  try {
    const value = sessionStorage.getItem(CLIENT_REG_TOKEN_KEY);
    return value && value.includes('.') ? value : null;
  } catch {
    return null;
  }
}

export function setClientRegToken(token: string): void {
  try {
    sessionStorage.setItem(CLIENT_REG_TOKEN_KEY, token);
  } catch {
    // Sin sessionStorage el flujo se reinicia en el paso 2.
  }
}
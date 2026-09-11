// Envío de correos de Styloren's.
//
// Avisa por email a la estilista asignada (y al correo general del salón, si
// lo configuraste) cada vez que entra una reserva nueva.
//
// CÓMO SE CONFIGURA — con variables de entorno. Hay dos formas:
//
//   A) Gmail (lo más fácil si ya tienes una cuenta de Gmail del salón):
//        GMAIL_USER=salon.styloren@gmail.com
//        GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
//      Ojo: NO es la contraseña normal de Gmail. Es una "contraseña de
//      aplicación" de 16 letras que se genera en la cuenta de Google, y para
//      poder generarla la cuenta necesita tener la verificación en dos pasos
//      activada.
//
//   B) Cualquier otro proveedor SMTP (Brevo, Zoho, el correo de tu dominio…):
//        SMTP_HOST=smtp-relay.brevo.com
//        SMTP_PORT=587
//        SMTP_USER=tu-usuario
//        SMTP_PASS=tu-clave
//        SMTP_FROM="Styloren's <avisos@tudominio.com>"   (opcional)
//
// Si no configuras ninguna de las dos, la agenda funciona igual: simplemente
// no manda correos (lo verás anotado en la consola del servidor).
"use strict";

const GMAIL_USER = process.env.GMAIL_USER || "";
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || "";

function isValidEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

// El nombre que se ve como remitente va entre comillas: así un apóstrofo
// (como el de "Styloren's") nunca rompe la cabecera del correo.
function quoteName(name) {
  return '"' + String(name || "").replace(/[\\"]/g, "\\$&") + '"';
}

function config() {
  if (GMAIL_USER && GMAIL_APP_PASSWORD) {
    return {
      kind: "gmail",
      label: "Gmail (" + GMAIL_USER + ")",
      address: GMAIL_USER,
      transport: {
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
      },
    };
  }
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    return {
      kind: "smtp",
      label: SMTP_HOST,
      // Varios proveedores usan como usuario algo que NO es una dirección de
      // correo. En ese caso hace falta SMTP_FROM para saber desde qué
      // dirección se envía.
      address: isValidEmail(SMTP_USER) ? SMTP_USER : "",
      transport: {
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      },
    };
  }
  return null;
}

// Arma la cabecera "De:" del correo.
function fromHeader(salonName) {
  const c = config();
  if (!c) return "";
  if (SMTP_FROM) return SMTP_FROM; // si lo definiste a mano, manda lo tuyo
  if (!c.address) return "";
  return `${quoteName(salonName || "Styloren's")} <${c.address}>`;
}

// Devuelve "" si todo está bien, o una explicación de qué falta.
function configProblem() {
  const c = config();
  if (!c) return "No hay configuración de correo en este servidor.";
  if (!fromHeader()) {
    return "Falta la variable SMTP_FROM: el usuario SMTP no es una dirección de correo, así que hay que indicar desde qué dirección se envían los avisos.";
  }
  return "";
}

const isConfigured = () => Boolean(config()) && !configProblem();
function describe() {
  const c = config();
  return c ? c.label : "";
}

let transporterPromise = null;
function getTransporter() {
  if (!transporterPromise) {
    transporterPromise = (async () => {
      const c = config();
      if (!c) throw new Error("El envío de correos no está configurado en este servidor.");
      // Se pide solo cuando de verdad hay que mandar un correo.
      const nodemailer = require("nodemailer");
      return nodemailer.createTransport(c.transport);
    })();
  }
  return transporterPromise;
}

async function sendMail({ to, subject, html, text, fromName }) {
  const recipients = (Array.isArray(to) ? to : [to]).map((t) => String(t || "").trim()).filter(isValidEmail);
  if (!recipients.length) return { sent: false, reason: "sin_destinatarios" };

  const problem = configProblem();
  if (problem) throw new Error(problem);

  const transporter = await getTransporter();
  await transporter.sendMail({
    from: fromHeader(fromName),
    to: recipients.join(", "),
    subject,
    text,
    html,
  });
  return { sent: true, recipients };
}

// ---------------------------------------------------------------------------
// Plantilla del correo de reserva nueva
// ---------------------------------------------------------------------------
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function fmtDate(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DIAS[dt.getDay()]} ${d} de ${MESES[m - 1]} de ${y}`;
}
function fmtTime(timeStr) {
  const [h, m] = String(timeStr).split(":").map(Number);
  const period = h >= 12 ? "pm" : "am";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}${m ? ":" + String(m).padStart(2, "0") : ""} ${period}`;
}
function cop(n) {
  return "$" + Math.round(Number(n) || 0).toLocaleString("es-CO") + " COP";
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function appointmentEmail(appt, business) {
  const salon = (business && business.name) || "Styloren's";
  const subject = `Nueva reserva · ${appt.serviceName} · ${fmtDate(appt.date)} ${fmtTime(appt.time)}`;

  const rows = [
    ["Servicio", appt.serviceName],
    ["Fecha", fmtDate(appt.date)],
    ["Hora", fmtTime(appt.time) + ` (${appt.durationMin} min)`],
    ["Clienta", appt.clientName],
    ["Celular", appt.clientPhone],
    ["Estilista", appt.staffName || "Sin preferencia"],
    ["Precio", cop(appt.priceCOP)],
  ];

  const html = `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px;background:#FBF5EF;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#2A1420;">
  <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid rgba(42,20,32,.14);border-radius:14px;overflow:hidden;">
    <div style="background:#6E1A38;color:#FBF5EF;padding:20px 24px;">
      <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.8;">${esc(salon)}</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px;">Nueva reserva</div>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 18px;font-size:15px;line-height:1.5;">
        <b>${esc(appt.clientName)}</b> acaba de reservar una cita${appt.staffName ? " con <b>" + esc(appt.staffName) + "</b>" : ""}.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        ${rows.map(([k, v]) => `<tr>
          <td style="padding:9px 0;color:#7A6259;border-bottom:1px dashed rgba(42,20,32,.14);">${esc(k)}</td>
          <td style="padding:9px 0;text-align:right;font-weight:600;border-bottom:1px dashed rgba(42,20,32,.14);">${esc(v)}</td>
        </tr>`).join("")}
      </table>
      <p style="margin:20px 0 0;font-size:13px;color:#7A6259;line-height:1.5;">
        Entra al panel del salón para confirmar o cancelar esta cita y dejar notas internas.
      </p>
    </div>
  </div>
  <p style="max-width:520px;margin:16px auto 0;font-size:11px;color:#7A6259;text-align:center;">
    Aviso automático de la agenda de ${esc(salon)}.
  </p>
</body></html>`;

  const text = [
    `Nueva reserva en ${salon}`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "Entra al panel del salón para confirmarla.",
  ].join("\n");

  return { subject, html, text };
}

function testEmail(business) {
  const salon = (business && business.name) || "Styloren's";
  return {
    subject: `Correo de prueba · ${salon}`,
    text: `Si estás leyendo esto, los avisos por correo de la agenda de ${salon} quedaron funcionando correctamente.`,
    html: `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px;background:#FBF5EF;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#2A1420;">
  <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid rgba(42,20,32,.14);border-radius:14px;padding:28px;text-align:center;">
    <div style="font-size:32px;">✓</div>
    <h1 style="font-size:19px;margin:10px 0 8px;">Todo quedó funcionando</h1>
    <p style="font-size:14px;color:#7A6259;line-height:1.55;margin:0;">
      Los avisos por correo de la agenda de <b>${esc(salon)}</b> están configurados correctamente.
      A partir de ahora, cada reserva nueva llega a este buzón.
    </p>
  </div>
</body></html>`,
  };
}

module.exports = { isConfigured, describe, configProblem, sendMail, appointmentEmail, testEmail, isValidEmail };

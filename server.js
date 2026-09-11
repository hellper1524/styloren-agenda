// Styloren's — servidor de la agenda del salón.
//
// Guarda todo en data/db.json cuando corres localmente, o en una base de
// datos MongoDB Atlas gratuita cuando defines la variable de entorno
// MONGODB_URI (necesario en hosting con disco temporal, como el plan
// gratuito de Render). Ver storage.js para el detalle.
"use strict";

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { loadDb, saveDb, usingMongo } = require("./storage");
const mailer = require("./mailer");

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Sesión de administrador: un código (PIN) simple guardado en la propia base
// de datos. No es un sistema de autenticación robusto — es un candado
// sencillo para que las clientas no vean el panel del salón por accidente.
// Si quieres algo más serio (usuarios y contraseñas por persona), avísame
// para la siguiente fase.
// ---------------------------------------------------------------------------
const sessions = new Map(); // token -> expiresAt (ms)
const SESSION_HOURS = 12;

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}
function isAuthenticated(req) {
  const cookies = parseCookies(req);
  const token = cookies["admin_token"];
  if (!token) return false;
  const expires = sessions.get(token);
  if (!expires || expires < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}
function requireAdmin(req, res, next) {
  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: "no_autorizado", message: "Inicia sesión en el panel con el código de acceso." });
  }
  next();
}

// ---------------------------------------------------------------------------
// Utilidades de dominio
// ---------------------------------------------------------------------------
function slugify(text, existingIds) {
  let base = String(text)
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "item";
  let id = base;
  let n = 2;
  while (existingIds.has(id)) {
    id = `${base}-${n++}`;
  }
  return id;
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function timeToMinutes(t) {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + (m || 0);
}
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}
function publicBusiness(business) {
  const { adminPin, ...rest } = business; // nunca exponer el PIN al cliente
  return rest;
}
function publicStaff(staff) {
  return staff.filter((s) => s.active).map(({ id, name, role }) => ({ id, name, role }));
}
// ¿A quién se le avisa de una reserva nueva?
//  - Si la clienta eligió estilista: a esa persona.
//  - Si no eligió ninguna: a todas las estilistas activas que tengan correo,
//    porque la cita queda sin dueña y alguien tiene que tomarla.
//  - Y siempre, además, al correo general del salón si está configurado.
function recipientsForAppointment(db, appointment) {
  const list = [];
  if (appointment.staffId) {
    const member = db.staff.find((s) => s.id === appointment.staffId);
    if (member && member.email) list.push(member.email);
  } else {
    db.staff.forEach((s) => { if (s.active && s.email) list.push(s.email); });
  }
  if (db.business.notifyEmail) list.push(db.business.notifyEmail);
  return [...new Set(list.map((e) => String(e).trim()).filter(Boolean))];
}

// Manda el aviso sin bloquear la respuesta a la clienta: si el correo falla
// o tarda, la reserva ya quedó guardada igual y ella ve su confirmación.
function notifyNewAppointment(db, appointment) {
  const to = recipientsForAppointment(db, appointment);
  if (!to.length || !mailer.isConfigured()) return;
  const { subject, html, text } = mailer.appointmentEmail(appointment, db.business);
  mailer.sendMail({ to, subject, html, text, fromName: db.business.name })
    .then((result) => {
      if (result.sent) console.log(`Aviso de reserva enviado a: ${result.recipients.join(", ")}`);
    })
    .catch((err) => {
      console.error("No se pudo enviar el aviso por correo de una reserva:", err.message);
    });
}

// Envuelve un handler async para que un error inesperado no cuelgue la
// petición: responde 500 en vez de dejar al cliente esperando para siempre.
function h(fn) {
  return (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: "server_error", message: "Ocurrió un error inesperado. Intenta de nuevo." });
    });
  };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
// El límite sube a 3 MB porque el logo del salón viaja dentro del JSON
// (el navegador lo reduce antes de enviarlo, así que en la práctica pesa
// mucho menos, pero dejamos margen).
app.use(express.json({ limit: "3mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---- Negocio (horarios, ciudad, nombre) -----------------------------------
app.get("/api/business", h(async (req, res) => {
  const db = await loadDb();
  res.json(publicBusiness(db.business));
}));

app.put("/api/business", requireAdmin, h(async (req, res) => {
  const db = await loadDb();
  const { name, city, hoursByDay, slotMinutes, notifyEmail } = req.body || {};
  if (name !== undefined) db.business.name = String(name).slice(0, 80);
  if (city !== undefined) db.business.city = String(city).slice(0, 80);
  if (notifyEmail !== undefined) {
    const value = String(notifyEmail).trim().slice(0, 120);
    if (value && !mailer.isValidEmail(value)) {
      return res.status(400).json({ error: "invalid_argument", message: "El correo del salón no parece válido. Revísalo o déjalo vacío." });
    }
    db.business.notifyEmail = value;
  }
  if (slotMinutes !== undefined) {
    const n = Number(slotMinutes);
    if (!Number.isFinite(n) || n < 5 || n > 240) {
      return res.status(400).json({ error: "invalid_argument", message: "La duración del turno debe estar entre 5 y 240 minutos." });
    }
    db.business.slotMinutes = n;
  }
  if (hoursByDay !== undefined) {
    for (const key of Object.keys(hoursByDay)) {
      const day = Number(key);
      if (!Number.isInteger(day) || day < 0 || day > 6) {
        return res.status(400).json({ error: "invalid_argument", message: "Día de la semana inválido: " + key });
      }
      const val = hoursByDay[key];
      if (val !== null) {
        if (!Array.isArray(val) || val.length !== 2 || val[0] >= val[1] || val[0] < 0 || val[1] > 24) {
          return res.status(400).json({ error: "invalid_argument", message: "Horario inválido para el día " + key });
        }
      }
    }
    db.business.hoursByDay = hoursByDay;
  }
  await saveDb(db);
  res.json(publicBusiness(db.business));
}));

// ---- Logo del salón ---------------------------------------------------------
// El logo se guarda dentro de la propia base de datos, codificado como texto
// (data URL). Así funciona igual en tu computador y en Render, sin necesitar
// una carpeta de archivos subidos (que en el plan gratuito de Render se
// borraría). El navegador lo reduce de tamaño antes de enviarlo.
const MAX_LOGO_CHARS = 1_400_000; // ≈1 MB de imagen ya codificada
app.put("/api/business/logo", requireAdmin, h(async (req, res) => {
  const { dataUrl } = req.body || {};
  const value = String(dataUrl || "");
  if (!value) {
    return res.status(400).json({ error: "invalid_argument", message: "No llegó ninguna imagen." });
  }
  if (!/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(value)) {
    return res.status(400).json({ error: "invalid_argument", message: "El archivo debe ser una imagen (PNG, JPG, WEBP o SVG)." });
  }
  if (value.length > MAX_LOGO_CHARS) {
    return res.status(413).json({ error: "too_large", message: "La imagen pesa demasiado. Usa una más pequeña (por ejemplo, de 500 px de ancho)." });
  }
  const db = await loadDb();
  db.business.logoDataUrl = value;
  await saveDb(db);
  res.json(publicBusiness(db.business));
}));

app.delete("/api/business/logo", requireAdmin, h(async (req, res) => {
  const db = await loadDb();
  db.business.logoDataUrl = "";
  await saveDb(db);
  res.json(publicBusiness(db.business));
}));

// ---- Textos editables de la página -------------------------------------------
app.get("/api/content", h(async (req, res) => {
  const db = await loadDb();
  res.json(db.content);
}));

app.put("/api/content", requireAdmin, h(async (req, res) => {
  const db = await loadDb();
  const incoming = req.body || {};
  // Solo se aceptan las claves que ya existen: así nadie puede inventar
  // campos nuevos ni inflar la base de datos desde el navegador.
  for (const key of Object.keys(incoming)) {
    if (Object.prototype.hasOwnProperty.call(db.content, key)) {
      db.content[key] = String(incoming[key] == null ? "" : incoming[key]).slice(0, 600);
    }
  }
  await saveDb(db);
  res.json(db.content);
}));

// ---- Servicios --------------------------------------------------------------
app.get("/api/services", h(async (req, res) => {
  const db = await loadDb();
  res.json(db.services.slice().sort((a, b) => (a.order || 0) - (b.order || 0)));
}));

app.post("/api/services", requireAdmin, h(async (req, res) => {
  const db = await loadDb();
  const { name, category, durationMin, priceCOP } = req.body || {};
  if (!name || !category || !durationMin || priceCOP === undefined) {
    return res.status(400).json({ error: "invalid_argument", message: "Faltan campos: nombre, categoría, duración y precio son obligatorios." });
  }
  const id = slugify(name, new Set(db.services.map((s) => s.id)));
  const order = db.services.length ? Math.max(...db.services.map((s) => s.order || 0)) + 1 : 1;
  const service = { id, name: String(name).slice(0, 80), category: String(category).slice(0, 40), durationMin: Number(durationMin), priceCOP: Number(priceCOP), order };
  db.services.push(service);
  await saveDb(db);
  res.status(201).json(service);
}));

app.put("/api/services/:id", requireAdmin, h(async (req, res) => {
  const db = await loadDb();
  const svc = db.services.find((s) => s.id === req.params.id);
  if (!svc) return res.status(404).json({ error: "not_found", message: "Ese servicio no existe." });
  const { name, category, durationMin, priceCOP, order } = req.body || {};
  if (name !== undefined) svc.name = String(name).slice(0, 80);
  if (category !== undefined) svc.category = String(category).slice(0, 40);
  if (durationMin !== undefined) {
    const n = Number(durationMin);
    if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: "invalid_argument", message: "Duración inválida." });
    svc.durationMin = n;
  }
  if (priceCOP !== undefined) {
    const n = Number(priceCOP);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: "invalid_argument", message: "Precio inválido." });
    svc.priceCOP = n;
  }
  if (order !== undefined) svc.order = Number(order);
  await saveDb(db);
  res.json(svc);
}));

app.delete("/api/services/:id", requireAdmin, h(async (req, res) => {
  const db = await loadDb();
  const before = db.services.length;
  db.services = db.services.filter((s) => s.id !== req.params.id);
  if (db.services.length === before) return res.status(404).json({ error: "not_found" });
  await saveDb(db);
  res.json({ ok: true });
}));

// ---- Equipo / trabajadores --------------------------------------------------
app.get("/api/staff", h(async (req, res) => {
  const db = await loadDb();
  res.json(publicStaff(db.staff));
}));

app.get("/api/staff/all", requireAdmin, h(async (req, res) => {
  const db = await loadDb();
  res.json(db.staff);
}));

app.post("/api/staff", requireAdmin, h(async (req, res) => {
  const db = await loadDb();
  const { name, role, email } = req.body || {};
  if (!name) return res.status(400).json({ error: "invalid_argument", message: "El nombre es obligatorio." });
  const mail = String(email || "").trim().slice(0, 120);
  if (mail && !mailer.isValidEmail(mail)) {
    return res.status(400).json({ error: "invalid_argument", message: "Ese correo no parece válido. Revísalo o déjalo vacío." });
  }
  const id = slugify(name, new Set(db.staff.map((s) => s.id)));
  const member = { id, name: String(name).slice(0, 80), role: String(role || "").slice(0, 60), email: mail, active: true };
  db.staff.push(member);
  await saveDb(db);
  res.status(201).json(member);
}));

app.put("/api/staff/:id", requireAdmin, h(async (req, res) => {
  const db = await loadDb();
  const member = db.staff.find((s) => s.id === req.params.id);
  if (!member) return res.status(404).json({ error: "not_found" });
  const { name, role, email, active } = req.body || {};
  if (name !== undefined) member.name = String(name).slice(0, 80);
  if (role !== undefined) member.role = String(role).slice(0, 60);
  if (email !== undefined) {
    const mail = String(email).trim().slice(0, 120);
    if (mail && !mailer.isValidEmail(mail)) {
      return res.status(400).json({ error: "invalid_argument", message: "Ese correo no parece válido. Revísalo o déjalo vacío." });
    }
    member.email = mail;
  }
  if (active !== undefined) member.active = Boolean(active);
  await saveDb(db);
  res.json(member);
}));

app.delete("/api/staff/:id", requireAdmin, h(async (req, res) => {
  const db = await loadDb();
  const before = db.staff.length;
  db.staff = db.staff.filter((s) => s.id !== req.params.id);
  if (db.staff.length === before) return res.status(404).json({ error: "not_found" });
  await saveDb(db);
  res.json({ ok: true });
}));

// ---- Citas -------------------------------------------------------------------
app.get("/api/appointments", requireAdmin, h(async (req, res) => {
  const db = await loadDb();
  res.json(db.appointments.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)));
}));

app.post("/api/appointments", h(async (req, res) => {
  const db = await loadDb();
  const { serviceId, staffId, date, time, clientName, clientPhone } = req.body || {};

  const service = db.services.find((s) => s.id === serviceId);
  if (!service) return res.status(400).json({ error: "invalid_argument", message: "El servicio seleccionado ya no existe. Elige otro." });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "invalid_argument", message: "Fecha inválida." });
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: "invalid_argument", message: "Hora inválida." });
  if (!clientName || String(clientName).trim().length < 2) return res.status(400).json({ error: "invalid_argument", message: "Escribe tu nombre completo." });
  if (!clientPhone || String(clientPhone).trim().length < 7) return res.status(400).json({ error: "invalid_argument", message: "Escribe un celular válido." });
  if (date < todayStr()) return res.status(400).json({ error: "invalid_argument", message: "No puedes reservar en una fecha pasada." });

  const weekday = new Date(date + "T00:00:00").getDay();
  const hours = db.business.hoursByDay[String(weekday)];
  if (!hours) return res.status(400).json({ error: "invalid_argument", message: "El salón no abre ese día." });
  const start = timeToMinutes(time);
  const end = start + service.durationMin;
  if (start < hours[0] * 60 || end > hours[1] * 60) {
    return res.status(400).json({ error: "invalid_argument", message: "Esa hora está fuera del horario de atención." });
  }

  let staff = null;
  if (staffId) {
    staff = db.staff.find((s) => s.id === staffId && s.active);
    if (!staff) return res.status(400).json({ error: "invalid_argument", message: "El estilista elegido ya no está disponible." });
    const clash = db.appointments.some((a) => a.staffId === staffId && a.date === date && a.status !== "cancelada" && overlaps(start, end, timeToMinutes(a.time), timeToMinutes(a.time) + a.durationMin));
    if (clash) return res.status(409).json({ error: "conflict", message: "Ese estilista ya tiene una cita a esa hora. Elige otra hora u otro profesional." });
  }

  const appointment = {
    id: crypto.randomUUID(),
    serviceId: service.id,
    serviceName: service.name,
    durationMin: service.durationMin,
    priceCOP: service.priceCOP,
    staffId: staff ? staff.id : null,
    staffName: staff ? staff.name : null,
    date,
    time,
    clientName: String(clientName).trim().slice(0, 80),
    clientPhone: String(clientPhone).trim().slice(0, 30),
    status: "pendiente",
    notes: "",
    createdAt: new Date().toISOString(),
  };
  db.appointments.push(appointment);
  await saveDb(db);
  res.status(201).json(appointment);
  notifyNewAppointment(db, appointment);
}));

app.patch("/api/appointments/:id", requireAdmin, h(async (req, res) => {
  const db = await loadDb();
  const appt = db.appointments.find((a) => a.id === req.params.id);
  if (!appt) return res.status(404).json({ error: "not_found" });
  const { status, notes } = req.body || {};
  if (status !== undefined) {
    if (!["pendiente", "confirmada", "cancelada"].includes(status)) {
      return res.status(400).json({ error: "invalid_argument", message: "Estado inválido." });
    }
    appt.status = status;
  }
  if (notes !== undefined) appt.notes = String(notes).slice(0, 2000);
  await saveDb(db);
  res.json(appt);
}));

// ---- Autenticación del panel --------------------------------------------------
app.get("/api/admin/session", (req, res) => {
  res.json({ authenticated: isAuthenticated(req) });
});

app.post("/api/admin/login", h(async (req, res) => {
  const db = await loadDb();
  const { pin } = req.body || {};
  if (String(pin || "") !== String(db.business.adminPin || "")) {
    return res.status(401).json({ error: "invalid_pin", message: "Código incorrecto." });
  }
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, Date.now() + SESSION_HOURS * 3600 * 1000);
  res.setHeader("Set-Cookie", `admin_token=${token}; HttpOnly; Path=/; Max-Age=${SESSION_HOURS * 3600}; SameSite=Lax`);
  res.json({ ok: true });
}));

app.post("/api/admin/logout", (req, res) => {
  const cookies = parseCookies(req);
  if (cookies.admin_token) sessions.delete(cookies.admin_token);
  res.setHeader("Set-Cookie", "admin_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
  res.json({ ok: true });
});

app.post("/api/admin/change-pin", requireAdmin, h(async (req, res) => {
  const db = await loadDb();
  const { currentPin, newPin } = req.body || {};
  if (String(currentPin || "") !== String(db.business.adminPin || "")) {
    return res.status(401).json({ error: "invalid_pin", message: "El código actual no coincide." });
  }
  if (!newPin || String(newPin).length < 4) {
    return res.status(400).json({ error: "invalid_argument", message: "El nuevo código debe tener al menos 4 caracteres." });
  }
  db.business.adminPin = String(newPin);
  await saveDb(db);
  res.json({ ok: true });
}));

// ---- Estado y prueba del correo ------------------------------------------------
app.get("/api/admin/email-status", requireAdmin, h(async (req, res) => {
  const db = await loadDb();
  res.json({
    configured: mailer.isConfigured(),
    provider: mailer.describe(),
    problem: mailer.configProblem(),
    salonEmail: db.business.notifyEmail || "",
    staffWithEmail: db.staff.filter((s) => s.active && s.email).length,
    activeStaff: db.staff.filter((s) => s.active).length,
  });
}));

app.post("/api/admin/test-email", requireAdmin, h(async (req, res) => {
  const db = await loadDb();
  const problem = mailer.configProblem();
  if (problem) {
    return res.status(400).json({
      error: "sin_configurar",
      message: problem + " Revisa la sección de avisos por correo del README.",
    });
  }
  const { to } = req.body || {};
  const target = String(to || db.business.notifyEmail || "").trim();
  if (!mailer.isValidEmail(target)) {
    return res.status(400).json({ error: "invalid_argument", message: "Escribe un correo válido al cual mandar la prueba." });
  }
  const { subject, html, text } = mailer.testEmail(db.business);
  try {
    await mailer.sendMail({ to: target, subject, html, text });
  } catch (err) {
    return res.status(502).json({ error: "envio_fallido", message: "No se pudo enviar: " + err.message });
  }
  res.json({ ok: true, to: target });
}));

app.listen(PORT, async () => {
  console.log(`Styloren's escuchando en http://localhost:${PORT}`);
  console.log(`Guardando datos en: ${usingMongo() ? "MongoDB Atlas (nube)" : "archivo local (data/db.json)"}`);
  console.log(mailer.isConfigured()
    ? `Avisos por correo: activados vía ${mailer.describe()}.`
    : `Avisos por correo: desactivados. ${mailer.configProblem()} La agenda funciona igual.`);
  try {
    const db = await loadDb();
    console.log(`Código de acceso al panel por defecto: ${db.business.adminPin} (cámbialo desde el panel, en Ajustes).`);
  } catch (err) {
    console.error("No se pudo conectar con la base de datos al arrancar:", err.message);
  }
});

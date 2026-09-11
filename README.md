# Styloren's — Agenda del salón

Agenda de reservas para el salón de belleza **Styloren's** (Puente Nacional). Incluye:

- Página pública para que tus clientas reserven citas (con catálogo de servicios y equipo de estilistas).
- Panel privado para el salón (protegido con un código de acceso), separado de lo que ven las clientas, donde puedes:
  - ver y confirmar/cancelar las citas, con notas internas por reserva,
  - editar precios y duración de los servicios,
  - agregar, editar o desactivar estilistas (y ponerle su correo a cada una),
  - **subir tu propio logo** y cambiarlo cuando quieras,
  - **cambiar cualquier texto de la página** sin tocar código,
  - editar el nombre del salón, la ciudad y el horario de atención,
  - cambiar el código de acceso del panel.
- **Aviso automático por correo** a la estilista cada vez que entra una reserva nueva (opcional; hay que configurarlo una vez — ver la sección 5).

Es una aplicación **con backend propio** (Node.js + Express) que guarda todo en un archivo `data/db.json` en tu propio servidor — no depende de Claude ni de ningún servicio externo para funcionar.

## 1. Requisitos

- [Node.js](https://nodejs.org) versión 18 o superior instalado en tu computador (o en el servidor donde lo vayas a publicar).

Para revisar si ya lo tienes, abre una terminal y escribe:

```
node -v
```

## 2. Instalar y correr en tu computador

Descomprime esta carpeta, abre una terminal dentro de ella y ejecuta:

```
npm install
npm start
```

Vas a ver un mensaje como:

```
Styloren's escuchando en http://localhost:3000
Código de acceso al panel por defecto: 1234 (cámbialo desde el panel, en Ajustes).
```

Abre esa dirección (`http://localhost:3000`) en tu navegador. Ahí verás la página pública. Para entrar al panel del salón, ve al enlace **"Acceso del equipo"** al final de la página, o entra directo a `http://localhost:3000/#panel`, e ingresa el código **1234** (cámbialo por uno tuyo desde Ajustes en cuanto entres — es importante, ver la sección de seguridad más abajo).

Los datos (servicios, citas, estilistas, horario) se guardan en `data/db.json`. Ese archivo se crea solo la primera vez que corres el servidor, a partir de la plantilla `data/db.seed.json` (que trae los 10 servicios y 2 estilistas de ejemplo con los que armé la primera versión). **Haz respaldo de `data/db.json` de vez en cuando** — es donde vive toda tu información real.

## 3. Publicarlo gratis para que tus clientas reserven desde internet

Mientras el servidor solo corre en tu computador (`npm start`), únicamente tú puedes abrir la página desde ese mismo computador. Para que tus clientas reserven desde su celular necesitas que el servidor quede accesible desde internet, 24 horas al día.

**La combinación que usamos (100% gratis):**

1. **GitHub** — guarda tu código (subido desde VS Code).
2. **Render** (render.com, plan gratuito) — corre el servidor y le da una dirección pública. Se "duerme" tras 15 minutos sin visitas y tarda ~30-60 segundos en despertar con la primera visita del día; después responde normal. Su disco es temporal, así que **no** guarda ahí los datos.
3. **MongoDB Atlas** (plan gratuito, para siempre) — aquí sí quedan guardadas tus citas, servicios y estilistas de forma permanente, sin importar que Render se duerma o se reinicie.

Por eso este proyecto tiene un archivo `storage.js`: si defines la variable de entorno `MONGODB_URI`, guarda todo en MongoDB Atlas (nube); si no la defines (como en tu computador ahora), sigue usando `data/db.json` normalmente. No tienes que cambiar nada a mano — el mismo código sirve para los dos casos.

> ¿Por qué no basta con Render solo? Porque su plan gratuito borra los archivos locales cada vez que el servicio se reinicia o se duerme — perderías las citas guardadas. Por eso se separa "dónde corre el servidor" (Render) de "dónde se guardan los datos" (MongoDB Atlas).

Los pasos completos (crear la base de datos en MongoDB Atlas, subir el código a GitHub desde VS Code, y conectar todo en Render) te los voy guiando en la conversación — pídemelos cuando estés lista para empezar.

**Alternativas** si más adelante quieres algo distinto:
- **Railway** (railway.app): si guarda archivos locales de forma permanente incluso en su plan gratuito/de prueba, pero ese plan solo trae unos días de crédito gratis — después cuesta desde unos $5 USD/mes.
- Un **VPS** (DigitalOcean, Hetzner, etc.): ahí si puedes usar `data/db.json` directamente sin MongoDB, porque el disco no se borra — pero tiene un costo mensual y requiere más configuración.

## 4. Cómo se usa el panel del salón

- El botón **"Acceso del equipo"** está solo en el pie de página — a propósito no aparece en el menú principal, para que las clientas no lo vean por accidente.
- El código de acceso es un candado sencillo (no es un sistema de usuarios con contraseñas individuales). Cualquiera con el código puede entrar al panel. Dado que es para un solo salón, normalmente es suficiente — pero si más adelante quieres cuentas separadas por persona, puedo agregarlo.
- Dentro del panel:
  - **Citas**: la agenda del día/semana, con botones para confirmar (✓) o cancelar (✕) cada cita, y un cuadro de notas internas por reserva.
  - **Servicios**: edita duración y precio de cada servicio, o agrega uno nuevo.
  - **Equipo**: agrega, edita o desactiva estilistas, y ponle a cada una su correo (un estilista desactivado deja de aparecer para las clientas, pero sus citas pasadas no se borran). **El correo es privado: las clientas nunca lo ven**, solo sirve para mandarle los avisos.
  - **Textos**: cambia cualquier texto de la página (títulos, descripciones, botones, pie de página). Donde escribas `{ciudad}` o `{salon}` se reemplaza solo por lo que tengas en Ajustes, así no hay que reescribir textos si cambias el nombre o la ciudad.
  - **Ajustes**: el logo, el nombre del salón, la ciudad, el horario por día, el correo general del salón y el código de acceso.

### El logo

En **Ajustes → Logo del salón**, "Elegir imagen…". Notas:

- Sirve PNG, JPG, WEBP o SVG. Un **PNG con fondo transparente** es lo que mejor se ve.
- La imagen se reduce sola a 520 px de ancho antes de guardarse, así que no hace falta que la prepares — pero tampoco subas una foto gigante de 10 MB (el máximo son 6 MB).
- El logo reemplaza el nombre escrito arriba de la página, aparece también en la portada y se usa como ícono de la pestaña del navegador.
- Se guarda dentro de la base de datos (no como archivo suelto), justamente para que siga ahí cuando publiques en Render.
- "Quitar logo" vuelve al nombre escrito.

## 5. Avisos por correo a las estilistas

Cada vez que una clienta reserva, el sistema puede mandar un correo automático con los datos de la cita:

- Si la clienta **eligió estilista**, le llega a esa persona.
- Si **no eligió ninguna**, le llega a todas las estilistas activas que tengan correo (la cita queda sin dueña y alguien tiene que tomarla).
- Y siempre, además, al **correo general del salón** si lo configuras en Ajustes.

Para que esto funcione, el servidor necesita una cuenta desde la cual enviar. Se configura **una sola vez**, con variables de entorno (en Render se ponen en la pestaña *Environment*; en tu computador, solo si quieres probarlo localmente).

### Opción A — Gmail (la más fácil si el salón ya tiene un Gmail)

| Variable | Valor |
|---|---|
| `GMAIL_USER` | el correo del salón, ej. `salon.styloren@gmail.com` |
| `GMAIL_APP_PASSWORD` | una **contraseña de aplicación** de 16 letras |

⚠️ **No es la contraseña normal de Gmail.** Es una clave aparte que genera Google solo para esto. Para poder crearla, esa cuenta de Gmail debe tener activada la **verificación en dos pasos**. Se genera en la configuración de seguridad de la cuenta de Google, en "Contraseñas de aplicaciones". Si te pierdas en ese paso, pídemelo y te lo guío con capturas.

### Opción B — otro proveedor (Brevo, Zoho, el correo de tu dominio…)

| Variable | Valor |
|---|---|
| `SMTP_HOST` | ej. `smtp-relay.brevo.com` |
| `SMTP_PORT` | ej. `587` |
| `SMTP_USER` | el usuario que te dé el proveedor |
| `SMTP_PASS` | la clave que te dé el proveedor |
| `SMTP_FROM` | opcional, pero **obligatorio si tu usuario no es una dirección de correo**. Ej. `Styloren's <avisos@tudominio.com>` |

### Comprobar que quedó bien

Entra al panel → **Ajustes → Avisos por correo**. Ahí verás:

- un aviso verde si el correo ya está funcionando (o uno gris explicando exactamente qué falta),
- un campo para el correo general del salón,
- un botón **"Enviar prueba"** que te manda un correo de prueba al instante.

**Si no configuras nada, la agenda funciona igual**: las reservas se guardan normal, simplemente no se manda ningún correo.

> ¿Y WhatsApp? Mandar WhatsApp automáticos requiere la API de Meta (verificación de empresa, número dedicado, plantillas aprobadas y pago por mensaje desde julio de 2025), así que quedó fuera por ahora. Si más adelante lo quieres, lo vemos.

## 6. Seguridad — qué sí y qué no hace este candado

El código de acceso evita que una clienta llegue por accidente al panel del salón, pero **no es un sistema de seguridad robusto**: el código se guarda en texto simple en `data/db.json` en tu propio servidor (nunca se envía al navegador de las clientas) y cualquiera que lo conozca puede entrar. Recomendaciones:

- Cambia el código por defecto (`1234`) apenas lo instales.
- No compartas el enlace `#panel` ni el código fuera de tu equipo.
- Si publicas esto en un hosting compartido con otras personas, protege también el acceso al archivo `data/db.json` (ahí quedan los datos de tus clientas: nombre y celular).
- Nunca subas a GitHub tus claves de correo ni la cadena de conexión de MongoDB: van en las variables de entorno del hosting, no dentro del código.

## 7. Estructura del proyecto

```
styloren-agenda/
├── server.js           # servidor Express + toda la lógica de la agenda
├── storage.js          # guarda en data/db.json (local) o en MongoDB Atlas si defines MONGODB_URI
├── mailer.js           # arma y envía los avisos por correo
├── package.json
├── data/
│   ├── db.seed.json    # plantilla inicial (servicios, estilistas y textos de ejemplo)
│   └── db.json         # se crea solo, en modo local — aquí vive tu información real
└── public/
    ├── index.html      # la página (inicio, servicios, equipo, reservar, panel)
    ├── styles.css      # estilos e identidad visual del salón
    └── app.js          # toda la lógica del navegador (llama a la API de server.js)
```

### Al actualizar desde una versión anterior

No se pierde nada. La primera vez que arranca, el servidor le agrega solo a tu base de datos los campos nuevos (logo, textos, correo por estilista) con los valores por defecto, **sin tocar** tus citas, precios, horarios ni el código de acceso que ya tuvieras.

## 8. Ideas para más adelante

- Notificaciones por **WhatsApp** (requiere la API de Meta: verificación de empresa, número dedicado y pago por mensaje — ver la nota de la sección 5).
- Recordatorio a la estilista **antes** de la cita (hoy el aviso se manda al momento de reservar).
- Confirmación por correo también **a la clienta** (hoy solo se le pide nombre y celular; habría que pedirle el correo).
- Reprogramar una cita (hoy solo se puede confirmar, cancelar o anotar).
- Reportes (servicios más pedidos, ingresos estimados).
- Cuentas individuales por estilista, si más de una persona va a usar el panel y quieres diferenciar quién hizo cada cambio.

---

Este proyecto también existe como página publicada dentro de Claude (con guardado propio de Claude); esta carpeta es la versión independiente para que la publiques donde tú quieras. Si sigues usando ambas, ten en cuenta que **son dos bases de datos separadas** — lo que reserves en una no aparece en la otra.

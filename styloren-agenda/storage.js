// Capa de almacenamiento de Styloren's.
//
// Modo local (por defecto, sin configurar nada): guarda todo en data/db.json
// en el propio computador/servidor — así es como corre en tu PC.
//
// Modo nube (cuando defines la variable de entorno MONGODB_URI): guarda todo
// en una base de datos MongoDB Atlas gratuita. Esto es necesario cuando
// publicas en un hosting con disco temporal (como el plan gratuito de
// Render), porque ahí los archivos locales se borran cada vez que el
// servicio se reinicia — la base de datos en la nube no se borra.
//
// El resto del servidor (server.js) no necesita saber cuál de los dos modos
// está activo: siempre llama a loadDb()/saveDb() y punto.
"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const SEED_PATH = path.join(DATA_DIR, "db.seed.json");

const MONGODB_URI = process.env.MONGODB_URI || "";
const usingMongo = () => Boolean(MONGODB_URI);

function readSeed() {
  const raw = fs.existsSync(SEED_PATH)
    ? fs.readFileSync(SEED_PATH, "utf8")
    : JSON.stringify({ business: {}, services: [], staff: [], appointments: [] }, null, 2);
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Modo local (archivo JSON)
// ---------------------------------------------------------------------------
function ensureLocalDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(readSeed(), null, 2));
    console.log("Se creó data/db.json a partir de la plantilla inicial.");
  }
}
function loadLocal() {
  ensureLocalDb();
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}
function saveLocal(data) {
  const tmp = DB_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

// ---------------------------------------------------------------------------
// Modo nube (MongoDB Atlas)
// ---------------------------------------------------------------------------
let mongoCollectionPromise = null;
function getMongoCollection() {
  if (!mongoCollectionPromise) {
    mongoCollectionPromise = (async () => {
      // Se pide solo cuando hace falta, para que el paquete "mongodb" nunca
      // se toque si estás corriendo en modo local.
      const { MongoClient } = require("mongodb");
      const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
      await client.connect();
      return client.db().collection("styloren_state");
    })();
  }
  return mongoCollectionPromise;
}
async function loadMongo() {
  const col = await getMongoCollection();
  let doc = await col.findOne({ _id: "main" });
  if (!doc) {
    doc = Object.assign({ _id: "main" }, readSeed());
    await col.insertOne(doc);
    console.log("Se sembró la base de datos en MongoDB Atlas a partir de la plantilla inicial.");
  }
  const { _id, ...data } = doc;
  return data;
}
async function saveMongo(data) {
  const col = await getMongoCollection();
  await col.updateOne({ _id: "main" }, { $set: data }, { upsert: true });
}

// ---------------------------------------------------------------------------
// Interfaz única que usa server.js
// ---------------------------------------------------------------------------
async function loadDb() {
  return usingMongo() ? loadMongo() : loadLocal();
}
async function saveDb(data) {
  return usingMongo() ? saveMongo(data) : saveLocal(data);
}

module.exports = { loadDb, saveDb, usingMongo };

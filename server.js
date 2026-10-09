// Sistema Punto de Venta - servidor local
// Corre en la PC principal y atiende a celulares/tablets en la misma red wifi.
// Sin dependencias externas: solo Node.js 22.13+ (usa node:sqlite).

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { spawn } = require('node:child_process');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'datos');
const BACKUP_DIR = path.join(DATA_DIR, 'respaldos');
const DB_FILE = path.join(DATA_DIR, 'pos.db');

fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ---------- Base de datos ----------
const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    pin TEXT NOT NULL UNIQUE,
    rol TEXT NOT NULL DEFAULT 'vendedor' CHECK (rol IN ('admin','vendedor')),
    activo INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT UNIQUE,
    nombre TEXT NOT NULL,
    categoria TEXT NOT NULL DEFAULT 'General',
    precio REAL NOT NULL DEFAULT 0,
    costo REAL NOT NULL DEFAULT 0,
    existencia REAL NOT NULL DEFAULT 0,
    controla_existencia INTEGER NOT NULL DEFAULT 1,
    activo INTEGER NOT NULL DEFAULT 1,
    creado TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT,
    telefono TEXT,
    primera_compra TEXT,
    numero_compras INTEGER NOT NULL DEFAULT 0,
    ultima_compra TEXT
  );

  CREATE TABLE IF NOT EXISTS ventas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    cliente_id INTEGER REFERENCES clientes(id),
    ticket_number INTEGER NOT NULL,
    total REAL NOT NULL,
    metodo TEXT NOT NULL CHECK (metodo IN ('efectivo','tarjeta','transferencia')),
    recibido REAL NOT NULL DEFAULT 0,
    cambio REAL NOT NULL DEFAULT 0,
    cancelada INTEGER NOT NULL DEFAULT 0,
    dispositivo TEXT
  );

  CREATE TABLE IF NOT EXISTS venta_detalle (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venta_id INTEGER NOT NULL REFERENCES ventas(id),
    producto_id INTEGER REFERENCES productos(id),
    nombre TEXT NOT NULL,
    precio REAL NOT NULL,
    cantidad REAL NOT NULL,
    subtotal REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ajustes (
    clave TEXT PRIMARY KEY,
    valor TEXT
  );

  CREATE TABLE IF NOT EXISTS categorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    creado TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS sesiones (
    token TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    creado TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas(fecha);
  CREATE INDEX IF NOT EXISTS idx_detalle_venta ON venta_detalle(venta_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_telefono ON clientes(telefono) WHERE telefono IS NOT NULL;
`);

if (!db.prepare('PRAGMA table_info(ventas)').all().some((columna) => columna.name === 'cliente_id')) {
  db.exec('ALTER TABLE ventas ADD COLUMN cliente_id INTEGER REFERENCES clientes(id)');
}
if (!db.prepare('PRAGMA table_info(ventas)').all().some((columna) => columna.name === 'ticket_number')) {
  db.exec('ALTER TABLE ventas ADD COLUMN ticket_number INTEGER');
}
db.exec(`
  WITH folios AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY date(fecha) ORDER BY id) AS numero
    FROM ventas
  )
  UPDATE ventas
  SET ticket_number = (SELECT numero FROM folios WHERE folios.id = ventas.id)
  WHERE ticket_number IS NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_ventas_fecha_ticket
    ON ventas(date(fecha), ticket_number);
`);

// Datos iniciales la primera vez
if (db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n === 0) {
  db.prepare("INSERT INTO usuarios (nombre, pin, rol) VALUES ('Administrador', '1234', 'admin')").run();
  db.prepare("INSERT INTO usuarios (nombre, pin, rol) VALUES ('Vendedor 1', '1111', 'vendedor')").run();
  const ins = db.prepare('INSERT INTO productos (codigo, nombre, categoria, precio, costo, existencia) VALUES (?,?,?,?,?,?)');
  [
    ['7501000000001', 'Refresco 600 ml', 'Bebidas', 20, 13, 48],
    ['7501000000002', 'Agua natural 1 L', 'Bebidas', 15, 8, 36],
    ['7501000000003', 'Papas fritas', 'Botanas', 18, 11, 30],
    ['7501000000004', 'Galletas', 'Botanas', 16, 10, 24],
    ['7501000000005', 'Café americano', 'Cafetería', 30, 8, 0],
    ['7501000000006', 'Sandwich', 'Comida', 45, 22, 12],
  ].forEach((p) => ins.run(...p));
  // El café no controla existencia (se prepara al momento)
  db.prepare("UPDATE productos SET controla_existencia = 0 WHERE nombre = 'Café americano'").run();
}
const setDefault = db.prepare('INSERT OR IGNORE INTO ajustes (clave, valor) VALUES (?, ?)');
const insertarCategoria = db.prepare('INSERT OR IGNORE INTO categorias (nombre) VALUES (?)');
for (const categoria of ['General', ...db.prepare("SELECT DISTINCT categoria FROM productos WHERE categoria IS NOT NULL AND TRIM(categoria) != '' ORDER BY categoria").all().map((r) => r.categoria)]) {
  insertarCategoria.run(categoria);
}
setDefault.run('negocio', 'Mi Negocio');
setDefault.run('direccion', '');
setDefault.run('mensaje_ticket', '¡Gracias por su compra!');

function ajustes() {
  const out = {};
  for (const r of db.prepare('SELECT clave, valor FROM ajustes').all()) out[r.clave] = r.valor;
  return out;
}

function transaccion(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------- Respaldo diario ----------
function respaldar() {
  const hoy = fechaLocal(new Date());
  const destino = path.join(BACKUP_DIR, `pos-${hoy}.db`);
  if (fs.existsSync(destino)) return;
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(DB_FILE, destino);
    // Conserva los últimos 30 respaldos
    const archivos = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('pos-')).sort();
    for (const f of archivos.slice(0, Math.max(0, archivos.length - 30))) fs.unlinkSync(path.join(BACKUP_DIR, f));
    console.log('Respaldo creado:', destino);
  } catch (e) {
    console.error('No se pudo respaldar:', e.message);
  }
}
respaldar();
setInterval(respaldar, 60 * 60 * 1000);

function fechaLocal(d) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

// ---------- Utilidades HTTP ----------
class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

function enviar(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function leerJSON(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 5e6) { reject(new HttpError(413, 'Solicitud demasiado grande')); req.destroy(); }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new HttpError(400, 'JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function usuarioDe(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.nombre, u.rol FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token = ? AND u.activo = 1`).get(token) || null;
}

function requiere(req, rol) {
  const u = usuarioDe(req);
  if (!u) throw new HttpError(401, 'Inicia sesión');
  if (rol === 'admin' && u.rol !== 'admin') throw new HttpError(403, 'Solo el administrador puede hacer esto');
  return u;
}

const redondea = (n) => Math.round(Number(n) * 100) / 100;

function categoriaNormalizada(nombre) {
  return String(nombre || '').trim() || 'General';
}

function validarProducto(b) {
  const nombre = String(b.nombre || '').trim();
  if (!nombre) throw new HttpError(400, 'El nombre es obligatorio');
  const precio = Number(b.precio);
  if (!Number.isFinite(precio) || precio < 0) throw new HttpError(400, 'Precio inválido');
  const categoria = categoriaNormalizada(b.categoria);
  db.prepare('INSERT OR IGNORE INTO categorias (nombre) VALUES (?)').run(categoria);
  return {
    codigo: String(b.codigo || '').trim() || null,
    nombre,
    categoria,
    precio: redondea(precio),
    costo: redondea(Number(b.costo) || 0),
    existencia: Number(b.existencia) || 0,
    controla_existencia: b.controla_existencia === false || b.controla_existencia === 0 ? 0 : 1,
    activo: b.activo === false || b.activo === 0 ? 0 : 1,
  };
}

function rangoFechas(q) {
  const hoy = fechaLocal(new Date());
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(q.get('desde') || '') ? q.get('desde') : hoy;
  const hasta = /^\d{4}-\d{2}-\d{2}$/.test(q.get('hasta') || '') ? q.get('hasta') : desde;
  return [desde + ' 00:00:00', hasta + ' 23:59:59'];
}

// ---------- API ----------
const rutas = [];
const ruta = (metodo, patron, fn) => rutas.push({ metodo, patron, fn });

ruta('GET', /^\/api\/info$/, () => ({ negocio: ajustes().negocio, direcciones: direccionesLocales() }));

ruta('POST', /^\/api\/login$/, async (req) => {
  const { pin } = await leerJSON(req);
  const u = db.prepare('SELECT id, nombre, rol FROM usuarios WHERE pin = ? AND activo = 1').get(String(pin || ''));
  if (!u) throw new HttpError(401, 'PIN incorrecto');
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sesiones (token, usuario_id) VALUES (?, ?)').run(token, u.id);
  return { token, usuario: u };
});

ruta('POST', /^\/api\/logout$/, (req) => {
  const token = (req.headers.authorization || '').slice(7);
  db.prepare('DELETE FROM sesiones WHERE token = ?').run(token);
  return { ok: true };
});

ruta('GET', /^\/api\/yo$/, (req) => ({ usuario: requiere(req), ajustes: ajustes() }));

ruta('GET', /^\/api\/categorias$/, (req) => {
  requiere(req);
  return db.prepare('SELECT * FROM categorias ORDER BY nombre').all();
});

ruta('POST', /^\/api\/categorias$/, async (req) => {
  requiere(req, 'admin');
  const { nombre } = await leerJSON(req);
  const categoria = String(nombre || '').trim();
  if (!categoria) {
    throw new HttpError(400, 'El nombre de la categoría es obligatorio');
  }
  if (categoria.length > 100) throw new HttpError(400, 'El nombre de la categoría no puede exceder 100 caracteres');
  try {
    const r = db.prepare('INSERT INTO categorias (nombre) VALUES (?)').run(categoria);
    return db.prepare('SELECT * FROM categorias WHERE id = ?').get(r.lastInsertRowid);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'La categoría ya existe');
    throw e;
  }
});

ruta('DELETE', /^\/api\/categorias\/(\d+)$/, (req, q, [id]) => {
  requiere(req, 'admin');
  return transaccion(() => {
    const categoria = db.prepare('SELECT * FROM categorias WHERE id = ?').get(id);
    if (!categoria) throw new HttpError(404, 'Categoría no encontrada');
    if (categoria.nombre === 'General') throw new HttpError(400, 'La categoría General no se puede eliminar');
    db.prepare('UPDATE productos SET categoria = ? WHERE categoria = ?').run('General', categoria.nombre);
    db.prepare('DELETE FROM categorias WHERE id = ?').run(id);
    return { ok: true };
  });
});

// Productos
ruta('GET', /^\/api\/productos$/, (req, q) => {
  requiere(req);
  const todos = q.get('todos') === '1';
  return db.prepare(`SELECT * FROM productos ${todos ? '' : 'WHERE activo = 1'} ORDER BY categoria, nombre`).all();
});

ruta('POST', /^\/api\/productos$/, async (req) => {
  requiere(req, 'admin');
  const p = validarProducto(await leerJSON(req));
  try {
    const r = db.prepare(`INSERT INTO productos (codigo, nombre, categoria, precio, costo, existencia, controla_existencia, activo)
      VALUES (?,?,?,?,?,?,?,?)`).run(p.codigo, p.nombre, p.categoria, p.precio, p.costo, p.existencia, p.controla_existencia, p.activo);
    return db.prepare('SELECT * FROM productos WHERE id = ?').get(r.lastInsertRowid);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Ya existe un producto con ese código');
    throw e;
  }
});

ruta('PUT', /^\/api\/productos\/(\d+)$/, async (req, q, [id]) => {
  requiere(req, 'admin');
  const p = validarProducto(await leerJSON(req));
  try {
    const r = db.prepare(`UPDATE productos SET codigo=?, nombre=?, categoria=?, precio=?, costo=?, existencia=?, controla_existencia=?, activo=?
      WHERE id = ?`).run(p.codigo, p.nombre, p.categoria, p.precio, p.costo, p.existencia, p.controla_existencia, p.activo, id);
    if (!r.changes) throw new HttpError(404, 'Producto no encontrado');
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Ya existe un producto con ese código');
    throw e;
  }
  return db.prepare('SELECT * FROM productos WHERE id = ?').get(id);
});

ruta('DELETE', /^\/api\/productos\/(\d+)$/, (req, q, [id]) => {
  requiere(req, 'admin');
  // Se desactiva en lugar de borrar para no romper el historial de ventas
  db.prepare('UPDATE productos SET activo = 0 WHERE id = ?').run(id);
  return { ok: true };
});

// Clientes
ruta('GET', /^\/api\/clientes$/, (req) => {
  requiere(req, 'admin');
  return db.prepare('SELECT * FROM clientes ORDER BY ultima_compra DESC, nombre COLLATE NOCASE').all();
});

// Ventas
ruta('POST', /^\/api\/ventas$/, async (req) => {
  const u = requiere(req);
  const b = await leerJSON(req);
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) throw new HttpError(400, 'La venta no tiene productos');
  const metodo = ['efectivo', 'tarjeta', 'transferencia'].includes(b.metodo) ? b.metodo : 'efectivo';
  const nombreCliente = String(b.cliente_nombre || '').trim();
  const telefonoIngresado = String(b.cliente_telefono || '').trim();
  const telefonoCliente = telefonoIngresado.replace(/\D/g, '') || null;
  if (nombreCliente.length > 120) throw new HttpError(400, 'El nombre del cliente no puede exceder 120 caracteres');
  if (telefonoIngresado && (!telefonoCliente || telefonoCliente.length > 20)) {
    throw new HttpError(400, 'El teléfono del cliente debe contener hasta 20 números');
  }

  const ventaId = transaccion(() => {
    let clienteId = null;
    if (nombreCliente || telefonoCliente) {
      const clientePorTelefono = telefonoCliente
        ? db.prepare('SELECT * FROM clientes WHERE telefono = ?').get(telefonoCliente)
        : null;
      const clientesPorNombre = nombreCliente
        ? db.prepare('SELECT * FROM clientes WHERE nombre = ? COLLATE NOCASE').all(nombreCliente)
        : [];
      const clientePorNombre = clientesPorNombre.length === 1 ? clientesPorNombre[0] : null;

      if (clientesPorNombre.length > 1 && !clientePorTelefono) {
        throw new HttpError(409, 'Hay varios clientes con ese nombre; proporciona su teléfono para identificarlo');
      }
      if (clientePorTelefono && clientePorNombre && clientePorTelefono.id !== clientePorNombre.id) {
        throw new HttpError(409, 'El nombre y el teléfono corresponden a clientes distintos');
      }

      const clienteExistente = clientePorTelefono || clientePorNombre;
      if (clienteExistente) {
        clienteId = clienteExistente.id;
        db.prepare('UPDATE clientes SET nombre = COALESCE(?, nombre), telefono = COALESCE(?, telefono) WHERE id = ?')
          .run(nombreCliente || null, telefonoCliente, clienteId);
      } else {
        const cliente = db.prepare('INSERT INTO clientes (nombre, telefono) VALUES (?, ?)')
          .run(nombreCliente || null, telefonoCliente);
        clienteId = cliente.lastInsertRowid;
      }
    }

    const getP = db.prepare('SELECT * FROM productos WHERE id = ? AND activo = 1');
    const lineas = items.map((it) => {
      const p = getP.get(Number(it.producto_id));
      const cantidad = Number(it.cantidad);
      if (!p) throw new HttpError(400, 'Un producto ya no está disponible');
      if (!(cantidad > 0)) throw new HttpError(400, `Cantidad inválida para ${p.nombre}`);
      if (p.controla_existencia && p.existencia < cantidad) {
        throw new HttpError(409, `No hay suficiente existencia de ${p.nombre} (quedan ${p.existencia})`);
      }
      return { p, cantidad, subtotal: redondea(p.precio * cantidad) };
    });
    const total = redondea(lineas.reduce((s, l) => s + l.subtotal, 0));
    const recibido = metodo === 'efectivo' ? redondea(Number(b.recibido) || total) : total;
    if (recibido < total) throw new HttpError(400, 'El monto recibido es menor al total');
    const cambio = redondea(recibido - total);
    const dispositivo = String(req.headers['user-agent'] || '').slice(0, 120);
    const fechaVenta = new Date();
    const fecha = `${fechaLocal(fechaVenta)} ${String(fechaVenta.getHours()).padStart(2, '0')}:${String(fechaVenta.getMinutes()).padStart(2, '0')}:${String(fechaVenta.getSeconds()).padStart(2, '0')}`;
    const ticketNumber = db.prepare(`SELECT COALESCE(MAX(ticket_number), 0) + 1 AS numero
      FROM ventas WHERE date(fecha) = ?`).get(fecha.slice(0, 10)).numero;
    const r = db.prepare(`INSERT INTO ventas
      (fecha, usuario_id, cliente_id, ticket_number, total, metodo, recibido, cambio, dispositivo)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(fecha, u.id, clienteId, ticketNumber, total, metodo, recibido, cambio, dispositivo);
    const insD = db.prepare('INSERT INTO venta_detalle (venta_id, producto_id, nombre, precio, cantidad, subtotal) VALUES (?,?,?,?,?,?)');
    const desc = db.prepare('UPDATE productos SET existencia = existencia - ? WHERE id = ? AND controla_existencia = 1');
    for (const l of lineas) {
      insD.run(r.lastInsertRowid, l.p.id, l.p.nombre, l.p.precio, l.cantidad, l.subtotal);
      desc.run(l.cantidad, l.p.id);
    }
    if (clienteId !== null) actualizarResumenCliente(clienteId);
    return r.lastInsertRowid;
  });
  return detalleVenta(ventaId);
});

function actualizarResumenCliente(id) {
  db.prepare(`UPDATE clientes SET
    numero_compras = (SELECT COUNT(*) FROM ventas WHERE cliente_id = ? AND cancelada = 0),
    primera_compra = (SELECT MIN(fecha) FROM ventas WHERE cliente_id = ? AND cancelada = 0),
    ultima_compra = (SELECT MAX(fecha) FROM ventas WHERE cliente_id = ? AND cancelada = 0)
    WHERE id = ?`).run(id, id, id, id);
}

function detalleVenta(id) {
  const v = db.prepare(`SELECT v.*, u.nombre AS vendedor, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono
    FROM ventas v JOIN usuarios u ON u.id = v.usuario_id LEFT JOIN clientes c ON c.id = v.cliente_id WHERE v.id = ?`).get(id);
  if (!v) throw new HttpError(404, 'Venta no encontrada');
  v.items = db.prepare('SELECT * FROM venta_detalle WHERE venta_id = ?').all(id);
  return v;
}

ruta('GET', /^\/api\/ventas$/, (req, q) => {
  const u = requiere(req);
  const [desde, hasta] = rangoFechas(q);
  const soloMias = u.rol !== 'admin';
  return db.prepare(`
    SELECT v.id, v.fecha, v.total, v.metodo, v.cancelada, c.nombre AS cliente_nombre, u.nombre AS vendedor,
      (SELECT SUM(cantidad) FROM venta_detalle d WHERE d.venta_id = v.id) AS piezas
    FROM ventas v JOIN usuarios u ON u.id = v.usuario_id LEFT JOIN clientes c ON c.id = v.cliente_id
    WHERE v.fecha BETWEEN ? AND ? ${soloMias ? 'AND v.usuario_id = ?' : ''}
    ORDER BY v.id DESC`).all(...(soloMias ? [desde, hasta, u.id] : [desde, hasta]));
});

ruta('GET', /^\/api\/ventas\/(\d+)$/, (req, q, [id]) => {
  const u = requiere(req);
  const v = detalleVenta(id);
  if (u.rol !== 'admin' && v.usuario_id !== u.id) throw new HttpError(403, 'No autorizado');
  return v;
});

ruta('POST', /^\/api\/ventas\/(\d+)\/cancelar$/, (req, q, [id]) => {
  requiere(req, 'admin');
  transaccion(() => {
    const v = db.prepare('SELECT * FROM ventas WHERE id = ?').get(id);
    if (!v) throw new HttpError(404, 'Venta no encontrada');
    if (v.cancelada) throw new HttpError(409, 'La venta ya estaba cancelada');
    db.prepare('UPDATE ventas SET cancelada = 1 WHERE id = ?').run(id);
    if (v.cliente_id !== null) actualizarResumenCliente(v.cliente_id);
    // Regresa la mercancía al inventario
    db.prepare(`UPDATE productos SET existencia = existencia + (
        SELECT SUM(d.cantidad) FROM venta_detalle d WHERE d.venta_id = ? AND d.producto_id = productos.id)
      WHERE controla_existencia = 1 AND id IN (SELECT producto_id FROM venta_detalle WHERE venta_id = ?)`).run(id, id);
  });
  return detalleVenta(id);
});

// Corte / reportes
ruta('GET', /^\/api\/corte$/, (req, q) => {
  requiere(req, 'admin');
  const [desde, hasta] = rangoFechas(q);
  const base = 'FROM ventas v WHERE v.cancelada = 0 AND v.fecha BETWEEN ? AND ?';
  const resumen = db.prepare(`SELECT COUNT(*) AS ventas, COALESCE(SUM(total),0) AS total ${base}`).get(desde, hasta);
  const porMetodo = db.prepare(`SELECT metodo, COUNT(*) AS ventas, SUM(total) AS total ${base} GROUP BY metodo`).all(desde, hasta);
  const porVendedor = db.prepare(`SELECT u.nombre, COUNT(*) AS ventas, SUM(v.total) AS total
    FROM ventas v JOIN usuarios u ON u.id = v.usuario_id WHERE v.cancelada = 0 AND v.fecha BETWEEN ? AND ?
    GROUP BY u.id ORDER BY total DESC`).all(desde, hasta);
  const productos = db.prepare(`SELECT d.nombre, SUM(d.cantidad) AS cantidad, SUM(d.subtotal) AS total,
      SUM(d.subtotal) - SUM(d.cantidad * COALESCE(p.costo, 0)) AS ganancia
    FROM venta_detalle d JOIN ventas v ON v.id = d.venta_id LEFT JOIN productos p ON p.id = d.producto_id
    WHERE v.cancelada = 0 AND v.fecha BETWEEN ? AND ?
    GROUP BY d.nombre ORDER BY total DESC`).all(desde, hasta);
  const cancelaciones = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total FROM ventas WHERE cancelada = 1 AND fecha BETWEEN ? AND ?').get(desde, hasta);
  const bajos = db.prepare('SELECT nombre, existencia FROM productos WHERE activo = 1 AND controla_existencia = 1 AND existencia <= 5 ORDER BY existencia').all();
  return { desde, hasta, resumen, porMetodo, porVendedor, productos, cancelaciones, bajos };
});

// Usuarios
ruta('GET', /^\/api\/usuarios$/, (req) => {
  requiere(req, 'admin');
  return db.prepare('SELECT id, nombre, pin, rol, activo FROM usuarios ORDER BY id').all();
});

function validarUsuario(b) {
  const nombre = String(b.nombre || '').trim();
  const pin = String(b.pin || '').trim();
  if (!nombre) throw new HttpError(400, 'El nombre es obligatorio');
  if (!/^\d{4,8}$/.test(pin)) throw new HttpError(400, 'El PIN debe tener de 4 a 8 números');
  return { nombre, pin, rol: b.rol === 'admin' ? 'admin' : 'vendedor', activo: b.activo === false || b.activo === 0 ? 0 : 1 };
}

ruta('POST', /^\/api\/usuarios$/, async (req) => {
  requiere(req, 'admin');
  const u = validarUsuario(await leerJSON(req));
  try {
    db.prepare('INSERT INTO usuarios (nombre, pin, rol, activo) VALUES (?,?,?,?)').run(u.nombre, u.pin, u.rol, u.activo);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Ese PIN ya lo usa otra persona');
    throw e;
  }
  return { ok: true };
});

ruta('PUT', /^\/api\/usuarios\/(\d+)$/, async (req, q, [id]) => {
  const yo = requiere(req, 'admin');
  const u = validarUsuario(await leerJSON(req));
  if (Number(id) === yo.id && (u.rol !== 'admin' || !u.activo)) throw new HttpError(400, 'No puedes quitarte a ti mismo el acceso de administrador');
  try {
    db.prepare('UPDATE usuarios SET nombre=?, pin=?, rol=?, activo=? WHERE id=?').run(u.nombre, u.pin, u.rol, u.activo, id);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Ese PIN ya lo usa otra persona');
    throw e;
  }
  if (!u.activo) db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(id);
  return { ok: true };
});

// Ajustes
ruta('PUT', /^\/api\/ajustes$/, async (req) => {
  requiere(req, 'admin');
  const b = await leerJSON(req);
  const up = db.prepare('INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor');
  for (const k of ['negocio', 'direccion', 'mensaje_ticket']) if (k in b) up.run(k, String(b[k]).slice(0, 200));
  return ajustes();
});

// ---------- Archivos estáticos ----------
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function servirArchivo(res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const archivo = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!archivo.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(archivo, (err, data) => {
    if (err) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ---------- Servidor ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  if (!url.pathname.startsWith('/api/')) return servirArchivo(res, url.pathname);
  const r = rutas.find((x) => x.metodo === req.method && x.patron.test(url.pathname));
  if (!r) return enviar(res, 404, { error: 'Ruta no encontrada' });
  try {
    const params = url.pathname.match(r.patron).slice(1);
    enviar(res, 200, await r.fn(req, url.searchParams, params));
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    enviar(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Error interno del servidor' });
  }
});

function direccionesLocales() {
  const out = [];
  for (const [nombre, lista] of Object.entries(os.networkInterfaces())) {
    for (const i of lista || []) {
      if (i.family === 'IPv4' && !i.internal && !/vEthernet|VirtualBox|VMware|WSL|Hyper-V/i.test(nombre)) {
        out.push(`http://${i.address}:${PORT}`);
      }
    }
  }
  return out;
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // El sistema ya está corriendo en otra ventana: solo abre el navegador
    console.log(`\nEl sistema ya está abierto. Abriendo el navegador…`);
    abrirNavegador();
    setTimeout(() => process.exit(0), 1500);
    return;
  }
  throw e;
});

// Con --abrir, abre el navegador de la PC al arrancar
function abrirNavegador() {
  if (!process.argv.includes('--abrir')) return;
  const url = `http://localhost:${PORT}`;
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    const p = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    p.on('error', () => console.log('Abre en el navegador: ' + url));
    p.unref();
  } catch {}
}

server.listen(PORT, '0.0.0.0', () => {
  abrirNavegador();
  console.log('\n==============================================');
  console.log('  SISTEMA PUNTO DE VENTA - funcionando');
  console.log('==============================================');
  console.log(`  En esta computadora:  http://localhost:${PORT}`);
  const ips = direccionesLocales();
  if (ips.length) {
    console.log('  Desde celular/tablet (misma red wifi):');
    for (const ip of ips) console.log('     ' + ip);
  }
  console.log('\n  No cierres esta ventana mientras vendas.');
  console.log('==============================================\n');
});

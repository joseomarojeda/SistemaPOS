// Sistema Punto de Venta - interfaz para PC, celular y tablet
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dinero = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hoy = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const METODOS = { efectivo: '💵 Efectivo', tarjeta: '💳 Tarjeta', transferencia: '📲 Transferencia' };

const estado = {
  token: leer('pos_token'),
  usuario: null,
  ajustes: {},
  productos: [],
  categorias: [],
  carrito: leerJSON('pos_carrito') || [],
  categoria: 'Todas',
  busqueda: '',
};

function leer(k) { try { return localStorage.getItem(k); } catch { return null; } }
function leerJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function guardar(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch {} }

async function api(ruta, opciones = {}) {
  const res = await fetch('/api' + ruta, {
    method: opciones.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(estado.token ? { Authorization: 'Bearer ' + estado.token } : {}) },
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  }).catch(() => { throw new Error('Sin conexión con la computadora principal. Revisa el wifi.'); });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && ruta !== '/login') { cerrarSesion(); throw new Error(data.error || 'Inicia sesión'); }
  if (!res.ok) throw new Error(data.error || 'Error ' + res.status);
  return data;
}

let avisoTimer;
function aviso(msg, tipo) {
  const el = $('#aviso');
  el.textContent = msg;
  el.className = 'aviso' + (tipo === 'error' ? ' error' : '');
  el.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => (el.hidden = true), tipo === 'error' ? 4500 : 2200);
}

function abrirModal(html) {
  $('#modal-caja').innerHTML = html;
  $('#modal').hidden = false;
  return $('#modal-caja');
}
function cerrarModal() { $('#modal').hidden = true; $('#modal-caja').innerHTML = ''; }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') cerrarModal(); });

// ---------- Inicio de sesión ----------
let pin = '';
function mostrarLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  pin = '';
  pintarPin();
  api('/info').then((i) => { $('#login-negocio').textContent = i.negocio; }).catch(() => {});
}
function pintarPin() {
  $('#pin-puntos').innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<span class="${i < pin.length ? 'lleno' : ''}"></span>`).join('');
}
$('#pin-teclado').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map((k) => `<button data-k="${k}">${k}</button>`).join('');
$('#pin-teclado').addEventListener('click', (e) => {
  const k = e.target.dataset.k;
  if (!k) return;
  teclaPin(k);
});
document.addEventListener('keydown', (e) => {
  if ($('#login').hidden) return;
  if (/^\d$/.test(e.key)) teclaPin(e.key);
  else if (e.key === 'Backspace') teclaPin('⌫');
  else if (e.key === 'Enter') teclaPin('✓');
});
function teclaPin(k) {
  $('#login-error').textContent = '';
  if (k === '⌫') pin = pin.slice(0, -1);
  else if (k === '✓') return entrar();
  else if (pin.length < 8) pin += k;
  pintarPin();
}
async function entrar() {
  if (pin.length < 4) return;
  try {
    const r = await api('/login', { method: 'POST', body: { pin } });
    estado.token = r.token;
    guardar('pos_token', r.token);
    await iniciar();
  } catch (err) {
    $('#login-error').textContent = err.message;
    pin = '';
    pintarPin();
  }
}
function cerrarSesion() {
  if (estado.token) fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + estado.token } }).catch(() => {});
  estado.token = null;
  estado.usuario = null;
  guardar('pos_token', null);
  mostrarLogin();
}

// ---------- Navegación ----------
function abrirMenu(abrir) {
  $('#menu').classList.toggle('abierto', abrir);
  $('#velo').classList.toggle('visible', abrir);
}
$('#btn-menu').addEventListener('click', () => abrirMenu(true));
$('#velo').addEventListener('click', () => abrirMenu(false));
$('#menu').addEventListener('click', () => abrirMenu(false));
window.addEventListener('hashchange', enrutar);

const VISTAS = { venta: vistaVenta, ventas: vistaVentas, clientes: vistaClientes, productos: vistaProductos, corte: vistaCorte, usuarios: vistaUsuarios, ajustes: vistaAjustes };

function enrutar() {
  if (!estado.usuario) return;
  let v = location.hash.slice(1) || 'venta';
  if (v === 'salir') { location.hash = 'venta'; return cerrarSesion(); }
  const enlace = $(`#menu a[href="#${v}"]`);
  if (!VISTAS[v] || (enlace?.hasAttribute('data-admin') && estado.usuario.rol !== 'admin')) v = 'venta';
  $$('#menu a').forEach((a) => a.classList.toggle('activo', a.getAttribute('href') === '#' + v));
  cerrarModal();
  VISTAS[v]().catch((e) => aviso(e.message, 'error'));
}

async function iniciar() {
  if (!estado.token) return mostrarLogin();
  try {
    const r = await api('/yo');
    estado.usuario = r.usuario;
    estado.ajustes = r.ajustes;
  } catch (err) {
    if (estado.token) { mostrarLogin(); $('#login-error').textContent = err.message; }
    return;
  }
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#titulo-negocio').textContent = estado.ajustes.negocio;
  $('#usuario-nombre').textContent = estado.usuario.nombre;
  $$('#menu [data-admin]').forEach((a) => (a.hidden = estado.usuario.rol !== 'admin'));
  enrutar();
}

// ---------- Vender ----------
async function vistaVenta() {
  estado.productos = await api('/productos');
  limpiarCarrito(true);
  $('#vista').innerHTML = `
    <div class="venta">
      <div>
        <div class="buscador">
          <input id="buscar" type="search" placeholder="Buscar producto o escanear código…" autocomplete="off" value="${esc(estado.busqueda)}">
          <div class="chips" id="chips"></div>
        </div>
        <div class="productos" id="productos"></div>
      </div>
      <aside class="carrito panel" id="carrito-lateral"></aside>
    </div>
    <div class="barra-carrito"><button class="btn btn-primario btn-grande" id="btn-ver-carrito"></button></div>`;

  const buscar = $('#buscar');
  buscar.addEventListener('input', () => { estado.busqueda = buscar.value; pintarProductos(); });
  // Los lectores de código de barras escriben el código y presionan Enter
  buscar.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = buscar.value.trim();
    const exacto = estado.productos.find((p) => p.codigo && p.codigo === q);
    const lista = filtrados();
    const p = exacto || (lista.length === 1 ? lista[0] : null);
    if (p) { agregar(p.id); buscar.value = ''; estado.busqueda = ''; pintarProductos(); }
    else if (q) aviso('No se encontró "' + q + '"', 'error');
  });
  $('#chips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    estado.categoria = c.dataset.cat;
    pintarProductos();
  });
  $('#productos').addEventListener('click', (e) => {
    const b = e.target.closest('.prod');
    if (b) agregar(Number(b.dataset.id));
  });
  $('#btn-ver-carrito').addEventListener('click', () => {
    if (!estado.carrito.length) return aviso('Agrega productos para vender');
    const caja = abrirModal('<div class="carrito" id="carrito-modal"></div>');
    pintarCarrito(caja.firstElementChild, true);
  });
  pintarProductos();
  pintarCarritos();
  if (matchMedia('(min-width: 900px)').matches) buscar.focus();
}

function filtrados() {
  const q = estado.busqueda.trim().toLowerCase();
  return estado.productos.filter((p) =>
    (estado.categoria === 'Todas' || p.categoria === estado.categoria) &&
    (!q || p.nombre.toLowerCase().includes(q) || (p.codigo || '').includes(q)));
}

function pintarProductos() {
  const cats = ['Todas', ...new Set(estado.productos.map((p) => p.categoria))];
  if (!cats.includes(estado.categoria)) estado.categoria = 'Todas';
  $('#chips').innerHTML = cats.map((c) => `<button class="chip ${c === estado.categoria ? 'activo' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
  const lista = filtrados();
  $('#productos').innerHTML = lista.length ? lista.map((p) => {
    const enCarrito = estado.carrito.find((l) => l.producto_id === p.id)?.cantidad || 0;
    const agotado = p.controla_existencia && p.existencia - enCarrito <= 0;
    const stock = p.controla_existencia ? `<span class="stock ${p.existencia <= 5 ? 'bajo' : ''}">Existencia: ${p.existencia}</span>` : '';
    return `<button class="prod" data-id="${p.id}" ${agotado && !enCarrito ? 'disabled' : ''}>
      ${enCarrito ? `<span class="badge">${enCarrito}</span>` : ''}
      <span class="nombre">${esc(p.nombre)}</span>${stock}
      <span class="precio">${dinero(p.precio)}</span></button>`;
  }).join('') : '<p class="vacio">No hay productos que coincidan.</p>';
}

function agregar(id, delta = 1) {
  const p = estado.productos.find((x) => x.id === id);
  if (!p) return;
  let l = estado.carrito.find((x) => x.producto_id === id);
  const nueva = (l?.cantidad || 0) + delta;
  if (delta > 0 && p.controla_existencia && nueva > p.existencia) return aviso(`Solo hay ${p.existencia} de ${p.nombre}`, 'error');
  if (!l) { l = { producto_id: id, nombre: p.nombre, precio: p.precio, cantidad: 0 }; estado.carrito.push(l); }
  l.cantidad = nueva;
  if (l.cantidad <= 0) estado.carrito = estado.carrito.filter((x) => x !== l);
  guardar('pos_carrito', estado.carrito);
  pintarProductos();
  pintarCarritos();
}

// Sincroniza el carrito guardado con precios actuales y quita lo que ya no existe
function limpiarCarrito() {
  estado.carrito = estado.carrito.filter((l) => {
    const p = estado.productos.find((x) => x.id === l.producto_id);
    if (p) { l.precio = p.precio; l.nombre = p.nombre; }
    return !!p;
  });
  guardar('pos_carrito', estado.carrito);
}

const totalCarrito = () => Math.round(estado.carrito.reduce((s, l) => s + l.precio * l.cantidad, 0) * 100) / 100;

function pintarCarritos() {
  const lateral = $('#carrito-lateral');
  if (lateral) pintarCarrito(lateral, false);
  const modal = $('#carrito-modal');
  if (modal) { if (estado.carrito.length) pintarCarrito(modal, true); else cerrarModal(); }
  const n = estado.carrito.reduce((s, l) => s + l.cantidad, 0);
  const b = $('#btn-ver-carrito');
  if (b) b.innerHTML = `<span>🛒 Carrito (${n})</span><span>${dinero(totalCarrito())}</span>`;
}

function pintarCarrito(el, enModal) {
  el.innerHTML = `
    <h2>Venta actual ${enModal ? '<button class="icon-btn" data-cerrar aria-label="Cerrar">✕</button>' : ''}</h2>
    <div class="carrito-lista">${estado.carrito.length ? estado.carrito.map((l) => `
      <div class="linea">
        <span class="n">${esc(l.nombre)}</span><span class="sub num">${dinero(l.precio * l.cantidad)}</span>
        <div class="cant"><button data-menos="${l.producto_id}">−</button><span>${l.cantidad}</span><button data-mas="${l.producto_id}">+</button>
          <span class="muted num">× ${dinero(l.precio)}</span></div>
        <button class="icon-btn" data-quitar="${l.producto_id}" aria-label="Quitar">🗑</button>
      </div>`).join('') : '<p class="vacio">Toca un producto para agregarlo.</p>'}</div>
    <div class="total-fila"><span>Total</span><span class="num">${dinero(totalCarrito())}</span></div>
    <button class="btn btn-primario btn-grande" data-cobrar ${estado.carrito.length ? '' : 'disabled'}>Cobrar</button>
    ${estado.carrito.length ? '<button class="btn btn-peligro" style="margin-top:8px" data-vaciar>Vaciar</button>' : ''}`;
  el.onclick = (e) => {
    const t = e.target;
    if (t.dataset.mas) agregar(Number(t.dataset.mas), 1);
    else if (t.dataset.menos) agregar(Number(t.dataset.menos), -1);
    else if (t.dataset.quitar) { const l = estado.carrito.find((x) => x.producto_id === Number(t.dataset.quitar)); agregar(l.producto_id, -l.cantidad); }
    else if ('vaciar' in t.dataset) { if (confirm('¿Vaciar la venta actual?')) { estado.carrito = []; guardar('pos_carrito', []); pintarProductos(); pintarCarritos(); } }
    else if ('cerrar' in t.dataset) cerrarModal();
    else if ('cobrar' in t.dataset) cobrar();
  };
}

function cobrar() {
  const total = totalCarrito();
  let metodo = 'efectivo';
  const billetes = [...new Set([total, ...[20, 50, 100, 200, 500, 1000].filter((b) => b > total).slice(0, 4)])];
  const caja = abrirModal(`
    <h2>Cobrar <button class="icon-btn" data-cerrar aria-label="Cerrar">✕</button></h2>
    <div class="total-fila" style="padding-top:0"><span>Total</span><span class="num">${dinero(total)}</span></div>
    <label for="cliente-nombre">Nombre del cliente (opcional)</label>
    <input id="cliente-nombre" maxlength="120" autocomplete="name">
    <label for="cliente-telefono">Teléfono (opcional)</label>
    <input id="cliente-telefono" type="tel" maxlength="30" inputmode="tel" autocomplete="tel">
    <div class="metodos">${Object.entries(METODOS).map(([k, v]) => `<button data-metodo="${k}" class="${k === metodo ? 'activo' : ''}">${v}</button>`).join('')}</div>
    <div id="efectivo">
      <label for="recibido">Recibido</label>
      <input id="recibido" type="number" inputmode="decimal" step="0.01" min="0" placeholder="${total.toFixed(2)}">
      <div class="rapidos">${billetes.map((b) => `<button data-billete="${b}">${b === total ? 'Exacto' : dinero(b).replace('.00', '')}</button>`).join('')}</div>
      <div class="cambio"><span>Cambio</span><span class="num" id="cambio">${dinero(0)}</span></div>
    </div>
    <button class="btn btn-primario btn-grande" id="confirmar">Confirmar venta</button>`);
  const recibido = $('#recibido', caja);
  const calcular = () => {
    const r = Number(recibido.value) || total;
    $('#cambio', caja).textContent = r >= total ? dinero(r - total) : 'Falta ' + dinero(total - r);
  };
  recibido.addEventListener('input', calcular);
  caja.onclick = async (e) => {
    const t = e.target;
    if ('cerrar' in t.dataset) cerrarModal();
    else if (t.dataset.metodo) {
      metodo = t.dataset.metodo;
      $$('[data-metodo]', caja).forEach((b) => b.classList.toggle('activo', b === t));
      $('#efectivo', caja).hidden = metodo !== 'efectivo';
    } else if (t.dataset.billete) { recibido.value = t.dataset.billete; calcular(); }
    else if (t.id === 'confirmar') {
      t.disabled = true;
      try {
        const venta = await api('/ventas', {
          method: 'POST',
          body: {
            metodo,
            recibido: Number(recibido.value) || total,
            cliente_nombre: $('#cliente-nombre', caja).value,
            cliente_telefono: $('#cliente-telefono', caja).value,
            items: estado.carrito.map(({ producto_id, cantidad }) => ({ producto_id, cantidad })),
          },
        });
        estado.carrito = [];
        guardar('pos_carrito', []);
        mostrarTicket(venta, true);
        estado.productos = await api('/productos');
        pintarProductos();
        pintarCarritos();
      } catch (err) {
        aviso(err.message, 'error');
        t.disabled = false;
      }
    }
  };
}

function htmlTicket(v) {
  const a = estado.ajustes;
  return `<div class="ticket">
    <div class="c"><strong>${esc(a.negocio)}</strong>${a.direccion ? '<br>' + esc(a.direccion) : ''}</div>
    <hr>Ticket: #${v.id}<br>${esc(v.fecha)}<br>Atendió: ${esc(v.vendedor)}
    ${v.cliente_nombre || v.cliente_telefono ? `<br>Cliente: ${esc(v.cliente_nombre || 'Sin nombre')}${v.cliente_telefono ? `<br>Teléfono: ${esc(v.cliente_telefono)}` : ''}` : ''}
    ${v.cancelada ? '<br><strong>*** VENTA CANCELADA ***</strong>' : ''}<hr>
    <table>${v.items.map((i) => `<tr><td>${i.cantidad} ${esc(i.nombre)}</td><td class="der">${dinero(i.subtotal)}</td></tr>`).join('')}</table><hr>
    <table><tr><td><strong>TOTAL</strong></td><td class="der"><strong>${dinero(v.total)}</strong></td></tr>
      <tr><td>${METODOS[v.metodo].replace(/^\S+ /, '')}</td><td class="der">${dinero(v.recibido)}</td></tr>
      ${v.metodo === 'efectivo' ? `<tr><td>Cambio</td><td class="der">${dinero(v.cambio)}</td></tr>` : ''}</table>
    <hr><div class="c">${esc(a.mensaje_ticket)}</div></div>`;
}

function mostrarTicket(v, nueva) {
  const caja = abrirModal(`
    <h2>${nueva ? '✅ Venta registrada' : 'Venta #' + v.id} <button class="icon-btn" data-cerrar aria-label="Cerrar">✕</button></h2>
    ${nueva && v.metodo === 'efectivo' ? `<div class="cambio"><span>Cambio</span><span class="num">${dinero(v.cambio)}</span></div>` : ''}
    ${htmlTicket(v)}
    <div class="botones">
      <button class="btn" data-imprimir>🖨 Imprimir</button>
      ${!nueva && estado.usuario.rol === 'admin' && !v.cancelada ? '<button class="btn btn-peligro" data-cancelar>Cancelar venta</button>' : ''}
      <button class="btn btn-primario" data-cerrar>${nueva ? 'Nueva venta' : 'Cerrar'}</button>
    </div>`);
  caja.onclick = async (e) => {
    const t = e.target;
    if ('cerrar' in t.dataset) { cerrarModal(); $('#buscar')?.focus(); }
    else if ('imprimir' in t.dataset) { $('#ticket-impresion').innerHTML = htmlTicket(v); window.print(); }
    else if ('cancelar' in t.dataset) {
      if (!confirm(`¿Cancelar la venta #${v.id} por ${dinero(v.total)}? La mercancía regresa al inventario.`)) return;
      try { await api(`/ventas/${v.id}/cancelar`, { method: 'POST' }); aviso('Venta cancelada'); cerrarModal(); enrutar(); }
      catch (err) { aviso(err.message, 'error'); }
    }
  };
}

// ---------- Historial de ventas ----------
async function vistaVentas() {
  const fecha = estado.fechaVentas || hoy();
  const ventas = await api('/ventas?desde=' + fecha);
  const validas = ventas.filter((v) => !v.cancelada);
  $('#vista').innerHTML = `
    <h2>Ventas</h2>
    <div class="fila" style="margin-bottom:12px"><input type="date" id="fecha" value="${fecha}" style="max-width:200px">
      <span class="muted">${validas.length} ventas · <strong>${dinero(validas.reduce((s, v) => s + v.total, 0))}</strong></span></div>
    <div class="panel tabla-wrap"><table>
      <thead><tr><th>Ticket</th><th>Hora</th><th>Cliente</th><th>Vendedor</th><th>Pago</th><th class="der">Total</th></tr></thead>
      <tbody>${ventas.map((v) => `<tr class="clic ${v.cancelada ? 'cancelada' : ''}" data-id="${v.id}">
        <td>#${v.id}</td><td>${v.fecha.slice(11, 16)}</td><td>${esc(v.cliente_nombre || 'Público en general')}</td>
        <td>${esc(v.vendedor)}</td><td>${METODOS[v.metodo]}</td><td class="der num">${dinero(v.total)}</td></tr>`).join('') || '<tr><td colspan="6" class="vacio">Sin ventas este día.</td></tr>'}</tbody>
    </table></div>`;
  $('#fecha').addEventListener('change', (e) => { estado.fechaVentas = e.target.value; vistaVentas(); });
  $('tbody').addEventListener('click', async (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) mostrarTicket(await api('/ventas/' + tr.dataset.id), false);
  });
}

// ---------- Clientes ----------
async function vistaClientes() {
  const clientes = await api('/clientes');
  $('#vista').innerHTML = `
    <h2>Clientes</h2>
    <div class="panel tabla-wrap"><table>
      <thead><tr><th>Nombre</th><th>Teléfono</th><th>Primera compra</th><th class="der">Compras</th><th>Última compra</th></tr></thead>
      <tbody>${clientes.map((c) => `<tr>
        <td>${esc(c.nombre || 'Sin nombre')}</td><td>${esc(c.telefono || '—')}</td>
        <td>${c.primera_compra ? esc(c.primera_compra.slice(0, 10)) : '—'}</td>
        <td class="der num">${c.numero_compras}</td>
        <td>${c.ultima_compra ? esc(c.ultima_compra.slice(0, 10)) : '—'}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="vacio">Aún no hay clientes registrados.</td></tr>'}</tbody>
    </table></div>`;
}

// ---------- Productos ----------
async function vistaProductos() {
  const productos = await api('/productos?todos=1');
  const categorias = await api('/categorias');
  estado.productos = productos;
  estado.categorias = categorias;
  const filtro = (estado.filtroProd || '').toLowerCase();
  const lista = productos.filter((p) => !filtro || p.nombre.toLowerCase().includes(filtro) || (p.codigo || '').includes(filtro) || p.categoria.toLowerCase().includes(filtro));
  const categoriasConProductos = estado.categorias.map((categoria) => ({
    ...categoria,
    productos: productos.filter((p) => p.categoria === categoria.nombre).length,
  }));
  $('#vista').innerHTML = `
    <h2>Productos</h2>
    <div class="fila" style="margin-bottom:12px">
      <input class="crece" id="filtro" type="search" placeholder="Buscar…" value="${esc(estado.filtroProd || '')}">
      <button class="btn" id="nueva-categoria">+ Agregar categoría</button>
      <button class="btn btn-primario" id="nuevo">+ Nuevo producto</button>
    </div>
    <div class="panel tabla-wrap"><table>
      <thead><tr><th>Producto</th><th>Código</th><th>Categoría</th><th class="der">Precio</th><th class="der">Costo</th><th class="der">Existencia</th><th></th></tr></thead>
      <tbody>${lista.map((p) => `<tr class="clic ${p.activo ? '' : 'cancelada'}" data-id="${p.id}">
        <td><strong>${esc(p.nombre)}</strong></td><td>${esc(p.codigo || '')}</td><td>${esc(p.categoria)}</td>
        <td class="der num">${dinero(p.precio)}</td><td class="der num">${dinero(p.costo)}</td>
        <td class="der num">${p.controla_existencia ? `<span class="etiqueta ${p.existencia <= 5 ? 'rojo' : ''}">${p.existencia}</span>` : '<span class="muted">—</span>'}</td>
        <td>${p.activo ? '' : '<span class="etiqueta">Inactivo</span>'}</td></tr>`).join('') || '<tr><td colspan="7" class="vacio">Sin productos.</td></tr>'}</tbody>
    </table></div>
    <section class="panel seccion tabla-wrap">
      <h3>Categorías</h3>
      <table>
        <thead><tr><th>Nombre</th><th class="der">Productos</th><th></th></tr></thead>
        <tbody>${categoriasConProductos.map((categoria) => `<tr>
          <td><strong>${esc(categoria.nombre)}</strong></td>
          <td class="der">${categoria.productos}</td>
          <td class="der">${categoria.nombre === 'General' ? '<span class="muted">Predeterminada</span>' : `<button class="btn btn-peligro" data-eliminar-categoria="${categoria.id}">Eliminar</button>`}</td>
        </tr>`).join('') || '<tr><td colspan="3" class="vacio">Sin categorías.</td></tr>'}</tbody>
      </table>
    </section>`;
  const f = $('#filtro');
  f.addEventListener('input', () => { estado.filtroProd = f.value; clearTimeout(f._t); f._t = setTimeout(() => vistaProductos().then(() => { const n = $('#filtro'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }), 250); });
  $('#nueva-categoria').addEventListener('click', crearCategoria);
  $('#nuevo').addEventListener('click', () => editarProducto({ activo: 1, controla_existencia: 1, categoria: 'General' }, productos));
  $('tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) editarProducto(productos.find((p) => p.id === Number(tr.dataset.id)), productos);
  });
  $('#vista').addEventListener('click', async (e) => {
    const boton = e.target.closest('[data-eliminar-categoria]');
    if (!boton) return;
    const categoria = categoriasConProductos.find((c) => c.id === Number(boton.dataset.eliminarCategoria));
    if (!categoria) return;
    const productosAReasignar = categoria.productos
      ? `\n\n${categoria.productos} producto(s) se reasignarán a "General".`
      : '';
    if (!confirm(`¿Eliminar la categoría "${categoria.nombre}"?${productosAReasignar}`)) return;
    boton.disabled = true;
    try {
      await api('/categorias/' + categoria.id, { method: 'DELETE' });
      aviso('Categoría eliminada');
      await vistaProductos();
    } catch (err) {
      aviso(err.message, 'error');
      boton.disabled = false;
    }
  });
}

function crearCategoria() {
  const caja = abrirModal(`
    <h2>Agregar categoría <button class="icon-btn" data-cerrar aria-label="Cerrar">✕</button></h2>
    <form id="form-categoria">
      <label for="nombre-categoria">Nombre de la categoría</label>
      <input id="nombre-categoria" name="nombre" required maxlength="100" placeholder="Ej. Bebidas">
      <div class="botones">
        <button type="button" class="btn" data-cerrar>Cancelar</button>
        <button type="submit" class="btn btn-primario">Guardar categoría</button>
      </div>
    </form>`);
  const form = $('#form-categoria', caja);
  $('#nombre-categoria', caja).focus();
  caja.onclick = (e) => { if ('cerrar' in e.target.dataset) cerrarModal(); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const boton = $('button[type="submit"]', form);
    boton.disabled = true;
    try {
      const nueva = await api('/categorias', { method: 'POST', body: { nombre: new FormData(form).get('nombre') } });
      estado.categorias = [...estado.categorias.filter((c) => c.nombre !== nueva.nombre), nueva]
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      cerrarModal();
      aviso('Categoría guardada');
      await vistaProductos();
    } catch (err) {
      aviso(err.message, 'error');
      boton.disabled = false;
    }
  };
}

async function agregarCategoria(caja, form) {
  const nombre = prompt('Nombre de la categoría');
  if (!nombre) return;
  const categoria = String(nombre).trim();
  if (!categoria) {
    aviso('La categoría no puede estar vacía', 'error');
    return;
  }
  try {
    const nueva = await api('/categorias', { method: 'POST', body: { nombre: categoria } });
    estado.categorias = [...estado.categorias.filter((c) => c.nombre !== nueva.nombre), nueva].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const cats = [...new Set([...estado.categorias.map((c) => c.nombre), ...estado.productos.map((p) => p.categoria)])].filter(Boolean);
    const list = $('#cats', caja);
    list.innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join('');
    form.categoria.value = nueva.nombre;
    aviso('Categoría guardada');
  } catch (err) { aviso(err.message, 'error'); }
}

function editarProducto(p, productos) {
  const cats = [...new Set([...estado.categorias.map((x) => x.nombre), ...productos.map((x) => x.categoria)])].filter(Boolean);
  const caja = abrirModal(`
    <h2>${p.id ? 'Editar producto' : 'Nuevo producto'} <button class="icon-btn" data-cerrar aria-label="Cerrar">✕</button></h2>
    <form id="form">
      <label>Nombre</label><input name="nombre" required value="${esc(p.nombre || '')}">
      <label>Código de barras (opcional)</label><input name="codigo" value="${esc(p.codigo || '')}" inputmode="numeric">
      <label>Categoría</label>
      <div class="fila" style="gap:8px; align-items:stretch">
        <input id="categoria" name="categoria" list="cats" value="${esc(p.categoria || '')}" class="crece">
        <button type="button" class="btn" id="btn-agregar-categoria">+ Agregar categoría</button>
      </div>
      <datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <div class="fila"><div class="crece"><label>Precio de venta</label><input name="precio" type="number" step="0.01" min="0" required value="${p.precio ?? ''}" inputmode="decimal"></div>
        <div class="crece"><label>Costo</label><input name="costo" type="number" step="0.01" min="0" value="${p.costo ?? ''}" inputmode="decimal"></div></div>
      <label class="check"><input type="checkbox" name="controla_existencia" ${p.controla_existencia ? 'checked' : ''}> Controlar existencia</label>
      <div id="exist"><label>Existencia</label><input name="existencia" type="number" step="any" value="${p.existencia ?? 0}" inputmode="decimal"></div>
      <label class="check"><input type="checkbox" name="activo" ${p.activo ? 'checked' : ''}> Disponible para vender</label>
      <div class="botones"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn-primario">Guardar</button></div>
    </form>`);
  const form = $('#form', caja);
  const toggle = () => ($('#exist', caja).hidden = !form.controla_existencia.checked);
  form.controla_existencia.addEventListener('change', toggle);
  $('#btn-agregar-categoria', caja).addEventListener('click', () => agregarCategoria(caja, form));
  toggle();
  caja.onclick = (e) => { if ('cerrar' in e.target.dataset) cerrarModal(); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    d.controla_existencia = form.controla_existencia.checked;
    d.activo = form.activo.checked;
    try {
      await api('/productos' + (p.id ? '/' + p.id : ''), { method: p.id ? 'PUT' : 'POST', body: d });
      aviso('Producto guardado');
      cerrarModal();
      vistaProductos();
    } catch (err) { aviso(err.message, 'error'); }
  };
}

// ---------- Corte de caja ----------
async function vistaCorte() {
  const desde = estado.corteDesde || hoy();
  const hasta = estado.corteHasta || desde;
  const c = await api(`/corte?desde=${desde}&hasta=${hasta}`);
  const ganancia = c.productos.reduce((s, p) => s + p.ganancia, 0);
  const metodo = (m) => c.porMetodo.find((x) => x.metodo === m)?.total || 0;
  $('#vista').innerHTML = `
    <h2>Corte de caja</h2>
    <div class="fila" style="margin-bottom:12px">
      <label style="margin:0">Del</label><input type="date" id="desde" value="${desde}" style="max-width:180px">
      <label style="margin:0">al</label><input type="date" id="hasta" value="${hasta}" style="max-width:180px">
      <button class="btn" id="imprimir-corte">🖨 Imprimir</button>
    </div>
    <div class="tarjetas">
      <div class="tarjeta"><div class="t">Total vendido</div><div class="v num">${dinero(c.resumen.total)}</div></div>
      <div class="tarjeta"><div class="t">Ventas</div><div class="v num">${c.resumen.ventas}</div></div>
      <div class="tarjeta"><div class="t">💵 Efectivo en caja</div><div class="v num">${dinero(metodo('efectivo'))}</div></div>
      <div class="tarjeta"><div class="t">💳 Tarjeta</div><div class="v num">${dinero(metodo('tarjeta'))}</div></div>
      <div class="tarjeta"><div class="t">📲 Transferencia</div><div class="v num">${dinero(metodo('transferencia'))}</div></div>
      <div class="tarjeta"><div class="t">Ganancia estimada</div><div class="v num">${dinero(ganancia)}</div></div>
    </div>
    ${c.cancelaciones.n ? `<p class="muted">${c.cancelaciones.n} venta(s) cancelada(s) por ${dinero(c.cancelaciones.total)}, no incluidas.</p>` : ''}
    <div class="seccion panel tabla-wrap"><h3>Por vendedor</h3><table>
      <thead><tr><th>Vendedor</th><th class="der">Ventas</th><th class="der">Total</th></tr></thead>
      <tbody>${c.porVendedor.map((v) => `<tr><td>${esc(v.nombre)}</td><td class="der">${v.ventas}</td><td class="der num">${dinero(v.total)}</td></tr>`).join('') || '<tr><td colspan="3" class="vacio">Sin ventas.</td></tr>'}</tbody></table></div>
    <div class="seccion panel tabla-wrap"><h3>Productos vendidos</h3><table>
      <thead><tr><th>Producto</th><th class="der">Cantidad</th><th class="der">Total</th><th class="der">Ganancia</th></tr></thead>
      <tbody>${c.productos.map((p) => `<tr><td>${esc(p.nombre)}</td><td class="der">${p.cantidad}</td><td class="der num">${dinero(p.total)}</td><td class="der num">${dinero(p.ganancia)}</td></tr>`).join('') || '<tr><td colspan="4" class="vacio">Sin ventas.</td></tr>'}</tbody></table></div>
    ${c.bajos.length ? `<div class="seccion panel"><h3>⚠️ Existencia baja</h3>${c.bajos.map((b) => `<span class="etiqueta rojo" style="margin:3px">${esc(b.nombre)}: ${b.existencia}</span>`).join('')}</div>` : ''}`;
  $('#desde').addEventListener('change', (e) => { estado.corteDesde = e.target.value; if (estado.corteHasta < e.target.value) estado.corteHasta = e.target.value; vistaCorte(); });
  $('#hasta').addEventListener('change', (e) => { estado.corteHasta = e.target.value; vistaCorte(); });
  $('#imprimir-corte').addEventListener('click', () => {
    $('#ticket-impresion').innerHTML = `<div class="ticket"><div class="c"><strong>${esc(estado.ajustes.negocio)}</strong><br>CORTE DE CAJA<br>${desde}${hasta !== desde ? ' al ' + hasta : ''}</div><hr>
      <table><tr><td>Ventas</td><td class="der">${c.resumen.ventas}</td></tr>
      ${Object.keys(METODOS).map((m) => `<tr><td>${METODOS[m].replace(/^\S+ /, '')}</td><td class="der">${dinero(metodo(m))}</td></tr>`).join('')}
      <tr><td><strong>TOTAL</strong></td><td class="der"><strong>${dinero(c.resumen.total)}</strong></td></tr></table><hr>
      <table>${c.porVendedor.map((v) => `<tr><td>${esc(v.nombre)}</td><td class="der">${dinero(v.total)}</td></tr>`).join('')}</table>
      <hr><div class="c">Impreso ${new Date().toLocaleString('es-MX')}</div></div>`;
    window.print();
  });
}

// ---------- Usuarios ----------
async function vistaUsuarios() {
  const usuarios = await api('/usuarios');
  $('#vista').innerHTML = `
    <h2>Usuarios</h2>
    <div class="fila" style="margin-bottom:12px"><span class="muted crece">Cada persona entra con su propio PIN y sus ventas quedan registradas a su nombre.</span>
      <button class="btn btn-primario" id="nuevo">+ Nuevo usuario</button></div>
    <div class="panel tabla-wrap"><table>
      <thead><tr><th>Nombre</th><th>PIN</th><th>Rol</th><th></th></tr></thead>
      <tbody>${usuarios.map((u) => `<tr class="clic ${u.activo ? '' : 'cancelada'}" data-id="${u.id}"><td><strong>${esc(u.nombre)}</strong></td><td>${'•'.repeat(u.pin.length)}</td>
        <td><span class="etiqueta ${u.rol === 'admin' ? 'verde' : ''}">${u.rol === 'admin' ? 'Administrador' : 'Vendedor'}</span></td><td>${u.activo ? '' : 'Inactivo'}</td></tr>`).join('')}</tbody>
    </table></div>`;
  $('#nuevo').addEventListener('click', () => editarUsuario({ rol: 'vendedor', activo: 1 }));
  $('tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) editarUsuario(usuarios.find((u) => u.id === Number(tr.dataset.id)));
  });
}

function editarUsuario(u) {
  const caja = abrirModal(`
    <h2>${u.id ? 'Editar usuario' : 'Nuevo usuario'} <button class="icon-btn" data-cerrar aria-label="Cerrar">✕</button></h2>
    <form id="form">
      <label>Nombre</label><input name="nombre" required value="${esc(u.nombre || '')}">
      <label>PIN (4 a 8 números)</label><input name="pin" required inputmode="numeric" pattern="\\d{4,8}" value="${esc(u.pin || '')}">
      <label>Rol</label><select name="rol"><option value="vendedor">Vendedor (solo vende y ve sus ventas)</option><option value="admin" ${u.rol === 'admin' ? 'selected' : ''}>Administrador (todo)</option></select>
      <label class="check"><input type="checkbox" name="activo" ${u.activo ? 'checked' : ''}> Activo</label>
      <div class="botones"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn-primario">Guardar</button></div>
    </form>`);
  const form = $('#form', caja);
  caja.onclick = (e) => { if ('cerrar' in e.target.dataset) cerrarModal(); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    d.activo = form.activo.checked;
    try {
      await api('/usuarios' + (u.id ? '/' + u.id : ''), { method: u.id ? 'PUT' : 'POST', body: d });
      aviso('Usuario guardado');
      cerrarModal();
      vistaUsuarios();
    } catch (err) { aviso(err.message, 'error'); }
  };
}

// ---------- Ajustes ----------
async function vistaAjustes() {
  const a = estado.ajustes;
  const info = await api('/info');
  $('#vista').innerHTML = `
    <h2>Ajustes</h2>
    <form class="panel" id="form" style="max-width:560px">
      <label>Nombre del negocio</label><input name="negocio" value="${esc(a.negocio)}">
      <label>Dirección / teléfono (aparece en el ticket)</label><input name="direccion" value="${esc(a.direccion)}">
      <label>Mensaje al final del ticket</label><input name="mensaje_ticket" value="${esc(a.mensaje_ticket)}">
      <div class="botones"><button class="btn btn-primario">Guardar</button></div>
    </form>
    <div class="panel seccion" style="max-width:560px">
      <h3>Conectar celulares y tablets</h3>
      <p class="muted">Conecta el dispositivo al mismo wifi que esta computadora y abre en su navegador:</p>
      ${info.direcciones.map((d) => `<p><strong style="font-size:1.2rem">${esc(d)}</strong></p>`).join('') || '<p>No se detectó una red. Revisa que la computadora esté conectada al wifi.</p>'}
      <p class="muted">Tip: en el navegador del celular usa "Agregar a pantalla de inicio" para abrirlo como una app.</p>
    </div>`;
  $('#form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      estado.ajustes = await api('/ajustes', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
      $('#titulo-negocio').textContent = estado.ajustes.negocio;
      aviso('Ajustes guardados');
    } catch (err) { aviso(err.message, 'error'); }
  };
}

iniciar();

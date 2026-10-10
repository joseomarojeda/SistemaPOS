'use strict';

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const estado = {
  token: localStorage.getItem('cocina_token'),
  usuario: null,
  historial: false,
  cargando: false,
  monitorInicializado: false,
  ordenesConocidas: new Map(),
  audioContext: null,
  sonidoActivado: false,
  sonidosPendientes: [],
};

async function api(ruta, opciones = {}) {
  const respuesta = await fetch('/api/cocina' + ruta, {
    method: opciones.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(estado.token ? { Authorization: 'Bearer ' + estado.token } : {}),
    },
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  }).catch(() => { throw new Error('Sin conexión con el sistema POS. Revisa el wifi.'); });
  const datos = await respuesta.json().catch(() => ({}));
  if (respuesta.status === 401 && ruta !== '/login') {
    cerrarSesion();
    throw new Error(datos.error || 'La sesión venció. Inicia sesión de nuevo.');
  }
  if (!respuesta.ok) throw new Error(datos.error || 'Error ' + respuesta.status);
  return datos;
}

function mostrarLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#pin').value = '';
  $('#pin').focus();
}

function mostrarError(mensaje) {
  $('#error').textContent = mensaje || '';
}

async function activarSonido(probar = true) {
  const ConstructorAudio = window.AudioContext || window.webkitAudioContext;
  if (!ConstructorAudio) {
    $('#estado-sonido').textContent = 'Este navegador no admite audio web.';
    return;
  }
  try {
    estado.audioContext ||= new ConstructorAudio();
    await estado.audioContext.resume();
    if (estado.audioContext.state !== 'running') throw new Error('El navegador mantiene el audio suspendido.');
    estado.sonidoActivado = true;
    $('#estado-sonido').textContent = 'Avisos sonoros activados';
    if (probar) reproducirTono([880, 1175]);
    const pendientes = estado.sonidosPendientes.splice(0);
    for (const frecuencias of pendientes) reproducirTono(frecuencias);
  } catch (error) {
    estado.sonidoActivado = false;
    $('#estado-sonido').textContent = 'No se pudo activar. Vuelve a probar.';
    console.error('No se pudo activar el sonido de cocina:', error);
  }
}

function reproducirTono(frecuencias) {
  const audio = estado.audioContext;
  if (!estado.sonidoActivado || !audio || audio.state !== 'running') {
    estado.sonidosPendientes.push(frecuencias);
    return;
  }
  try {
    const inicio = audio.currentTime;
    frecuencias.forEach((frecuencia, indice) => {
      const cuando = inicio + indice * 0.25;
      const oscilador = audio.createOscillator();
      const volumen = audio.createGain();
      oscilador.type = 'sine';
      oscilador.frequency.setValueAtTime(frecuencia, cuando);
      volumen.gain.setValueAtTime(0.0001, cuando);
      volumen.gain.exponentialRampToValueAtTime(0.35, cuando + 0.025);
      volumen.gain.exponentialRampToValueAtTime(0.0001, cuando + 0.22);
      oscilador.connect(volumen);
      volumen.connect(audio.destination);
      oscilador.start(cuando);
      oscilador.stop(cuando + 0.23);
    });
  } catch (error) {
    estado.sonidoActivado = false;
    $('#estado-sonido').textContent = 'Error al reproducir. Pulsa “Probar sonido”.';
    console.error('No se pudo reproducir el aviso de cocina:', error);
    estado.sonidosPendientes.push(frecuencias);
  }
}

function avisarSonido(frecuencias) {
  if (!estado.sonidoActivado || !estado.audioContext || estado.audioContext.state !== 'running') {
    estado.sonidosPendientes.push(frecuencias);
    $('#estado-sonido').textContent = 'Hay avisos pendientes. Pulsa “Probar sonido”.';
    return;
  }
  reproducirTono(frecuencias);
}

function detectarCambios(ordenes) {
  if (!estado.monitorInicializado) {
    estado.ordenesConocidas = new Map(ordenes.map((orden) => [orden.id, orden.estado]));
    estado.monitorInicializado = true;
    return;
  }
  for (const orden of ordenes) {
    const estadoAnterior = estado.ordenesConocidas.get(orden.id);
    if (estadoAnterior === undefined) avisarSonido([660, 880]);
    else if (estadoAnterior !== 'listo' && orden.estado === 'listo') avisarSonido([784, 988, 1175]);
    estado.ordenesConocidas.set(orden.id, orden.estado);
  }
}

function fechaHora(fecha) {
  if (!fecha) return '—';
  const valor = new Date(fecha.replace(' ', 'T'));
  return Number.isNaN(valor.getTime()) ? fecha : valor.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
}

function nombreEstado(valor) {
  return valor === 'listo' ? 'Lista' : valor === 'retirado' ? 'Retirada' : valor === 'cancelado' ? 'Cancelada' : 'Preparando';
}

function tarjetaOrden(orden, activa) {
  const hora = fechaHora(orden.fecha);
  const cliente = orden.cliente ? `<span>Cliente: ${esc(orden.cliente)}</span>` : '';
  const detalleEstado = orden.estado === 'cancelado'
    ? 'Orden cancelada'
    : orden.estado === 'retirado'
      ? 'Retirada: ' + esc(fechaHora(orden.retirado_en))
      : orden.estado === 'listo'
        ? 'Lista para retirar'
        : 'En preparación';
  const accion = activa
    ? `<button class="button ${orden.estado === 'listo' ? 'success' : 'primary'}" data-orden="${orden.id}" data-estado="${orden.estado === 'listo' ? 'retirado' : 'listo'}">${orden.estado === 'listo' ? 'Marcar retirada de cocina' : 'Marcar como lista'}</button>`
    : `<p class="completed-time">${detalleEstado}</p>`;
  return `<article class="order-card ${esc(orden.estado)}">
    <header class="order-head">
      <div class="order-id"><strong>Orden #${esc(orden.ticket_number)}</strong><span class="status ${esc(orden.estado)}">${nombreEstado(orden.estado)}</span></div>
      <time>${esc(hora)}</time>
    </header>
    <div class="order-meta">${cliente}<span>Atendió: ${esc(orden.vendedor)}</span></div>
    <ul class="order-items">${orden.items.map((item) => `<li><span>${esc(item.nombre)}</span><strong>× ${esc(item.cantidad)}</strong></li>`).join('')}</ul>
    <footer class="order-foot">${accion}</footer>
  </article>`;
}

function pintarOrdenes(selector, ordenes, activa) {
  const contenedor = $(selector);
  contenedor.innerHTML = ordenes.length
    ? ordenes.map((orden) => tarjetaOrden(orden, activa)).join('')
    : `<div class="empty"><span aria-hidden="true">${activa ? '✓' : '⌕'}</span><strong>${activa ? 'No hay órdenes activas' : 'Aún no hay órdenes en el historial de hoy'}</strong><p>${activa ? 'Las nuevas órdenes aparecerán aquí al cobrarse en el POS.' : 'Las órdenes nuevas aparecerán aquí hasta el siguiente cierre de caja.'}</p></div>`;
}

function pintarActivas(ordenes) {
  const grupos = [
    ['preparando', '#ordenes-preparando', '#conteo-preparando'],
    ['listo', '#ordenes-listas', '#conteo-listas'],
    ['retirado', '#ordenes-retiradas', '#conteo-retiradas'],
  ];
  for (const [estadoOrden, selector, contador] of grupos) {
    const grupo = ordenes.filter((orden) => orden.estado === estadoOrden);
    $(contador).textContent = grupo.length;
    $(selector).innerHTML = grupo.length
      ? grupo.map((orden) => tarjetaOrden(orden, true)).join('')
      : '<p class="group-empty">Sin órdenes.</p>';
  }
}

async function cargarOrdenes() {
  if (!estado.token || estado.cargando) return;
  estado.cargando = true;
  mostrarError('');
  try {
    const activas = await api('/pedidos');
    detectarCambios(activas);
    $('#conteo-activas').textContent = activas.length;
    pintarActivas(activas);
    const historial = await api('/pedidos?historial=1');
    $('#conteo-historial').textContent = historial.length;
    if (estado.historial) {
      pintarOrdenes('#ordenes-historial', historial, false);
    }
    $('#ultima-actualizacion').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  } catch (error) {
    mostrarError(error.message);
  } finally {
    estado.cargando = false;
  }
}

async function entrar(pin) {
  try {
    const respuesta = await api('/login', { method: 'POST', body: { pin } });
    estado.token = respuesta.token;
    estado.usuario = respuesta.usuario;
    localStorage.setItem('cocina_token', respuesta.token);
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#usuario-nombre').textContent = respuesta.usuario.nombre;
    await cargarOrdenes();
  } catch (error) {
    $('#login-error').textContent = error.message;
    $('#pin').value = '';
    $('#pin').focus();
  }
}

function cerrarSesion() {
  if (estado.token) {
    fetch('/api/cocina/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + estado.token } }).catch(() => {});
  }
  estado.token = null;
  estado.usuario = null;
  estado.monitorInicializado = false;
  estado.ordenesConocidas.clear();
  localStorage.removeItem('cocina_token');
  mostrarLogin();
}

$('#login-form').addEventListener('submit', (event) => {
  event.preventDefault();
  $('#login-error').textContent = '';
  activarSonido(false);
  entrar($('#pin').value.trim());
});

document.querySelectorAll('[data-tab]').forEach((boton) => {
  boton.addEventListener('click', () => {
    estado.historial = boton.dataset.tab === 'historial';
    document.querySelectorAll('[data-tab]').forEach((tab) => tab.classList.toggle('active', tab === boton));
    $('#panel-activas').hidden = estado.historial;
    $('#panel-historial').hidden = !estado.historial;
    $('#heading-title').textContent = estado.historial ? 'Historial de hoy' : 'Órdenes activas';
    cargarOrdenes();
  });
});

document.addEventListener('click', async (event) => {
  const boton = event.target.closest('[data-orden]');
  if (!boton) return;
  boton.disabled = true;
  try {
    await api('/pedidos/' + boton.dataset.orden + '/estado', {
      method: 'PUT',
      body: { estado: boton.dataset.estado },
    });
    await cargarOrdenes();
  } catch (error) {
    mostrarError(error.message);
    boton.disabled = false;
  }
});

$('#btn-actualizar').addEventListener('click', cargarOrdenes);
$('#btn-salir').addEventListener('click', cerrarSesion);
$('#btn-sonido').addEventListener('click', () => activarSonido(true));

if (estado.token) {
  $('#app').hidden = false;
  $('#login').hidden = true;
  api('/yo').then((respuesta) => {
    estado.usuario = respuesta.usuario;
    $('#usuario-nombre').textContent = respuesta.usuario.nombre;
    return cargarOrdenes();
  }).catch((error) => {
    mostrarError(error.message);
    mostrarLogin();
  });
} else {
  mostrarLogin();
}

setInterval(() => {
  if (!document.hidden) cargarOrdenes();
}, 5000);

# Sistema Punto de Venta

Sistema de punto de venta local para Windows, construido con Node.js y SQLite. Permite registrar ventas, controlar productos e inventario y consultar tickets desde la computadora principal o desde otros dispositivos conectados a la misma red local.

## Requisitos

- Windows.
- Node.js 22.13 o posterior. El servidor usa `node:sqlite`, incluido en Node.js; no requiere instalar dependencias de npm.
- Para usar celulares o tabletas, los dispositivos deben estar conectados a la misma red Wi-Fi que la computadora que ejecuta el servidor.

## Instalación

1. Descarga o clona este repositorio en `Documentos\SistemaPOS` dentro de tu carpeta de usuario de Windows.
2. Ejecuta `INSTALAR.bat` y sigue las instrucciones. El instalador instala Node.js si hace falta, crea el acceso directo del escritorio y configura el firewall de Windows para permitir conexiones al puerto 3000.

   Como alternativa, abre `INSTALAR-PowerShell.txt`, copia su contenido en PowerShell y ejecútalo. Este instalador también espera encontrar el proyecto en `Documentos\SistemaPOS`.

La instalación **no inicia el servidor ni configura el inicio automático con Windows**. Si existe un acceso directo antiguo de Punto de Venta en la carpeta Inicio de Windows, el instalador lo elimina.

## Iniciar y detener

- Para iniciar el sistema, abre **Punto de Venta** desde el escritorio. Esto ejecuta `INICIAR.bat` y abre la aplicación en el navegador.
- Mantén abierta la ventana del servidor mientras uses el punto de venta.
- Para detener el sistema, cierra la ventana del servidor.
- El servidor escucha en el puerto `3000`. Si ya está ejecutándose, el acceso directo abre el sistema existente en lugar de iniciar otra instancia.

En esta computadora, abre <http://localhost:3000>. Para acceder desde un celular o tableta, usa la dirección de red local que muestra el servidor, con el mismo puerto (por ejemplo, `http://192.168.1.50:3000`).

## Usuarios iniciales

| Rol | PIN inicial |
| --- | --- |
| Administrador | `1234` |
| Vendedor | `1111` |

Cambia estos PIN en **Usuarios** después de la instalación. Los vendedores pueden registrar ventas y consultar sus ventas; el administrador también puede administrar productos, clientes, usuarios y ajustes, y consultar los cortes de caja.

## Funcionalidades

- Búsqueda de productos y lectura de códigos de barras USB o Bluetooth.
- Registro de ventas en efectivo, con tarjeta o por transferencia.
- Control de existencias, cantidades y devoluciones de inventario al cancelar una venta.
- Folio de ticket consecutivo que empieza en `1` cada día; el próximo número aparece en **Venta actual**.
- Historial de ventas por fecha e impresión de tickets.
- Nombre y teléfono opcionales al cobrar. Las ventas quedan vinculadas al cliente encontrado por teléfono o, si el nombre identifica a una sola persona, por nombre.
- Registro de clientes con fechas de primera y última compra y número de ventas vigentes. Las ventas canceladas no se cuentan.
- Corte de caja y reportes de ventas y productos.

## Datos y respaldos

- La base de datos principal se guarda en `datos\pos.db`.
- Los respaldos diarios se guardan en `datos\respaldos` y se conservan hasta los 30 más recientes.
- Incluye `datos` en tus respaldos externos para conservar ventas, clientes, productos e inventario. No reemplaces la base de datos mientras el servidor está en ejecución.
- El contenido de `datos` y los archivos de base de datos SQLite están excluidos del repositorio mediante `.gitignore`.

## Estructura del proyecto

```text
SistemaPOS/
├── public/                   Interfaz web y recursos estáticos
├── datos/                    Base de datos local y respaldos (no versionados)
├── server.js                 Servidor HTTP, API y esquema SQLite
├── INICIAR.bat               Inicia manualmente el punto de venta
├── INSTALAR.bat              Instala Node.js y configura Windows
└── INSTALAR-PowerShell.txt   Instalación alternativa desde PowerShell
```

## Comprobación rápida

Comprueba la sintaxis del servidor y de la interfaz desde la carpeta del proyecto:

```powershell
node --check server.js
node --check public\app.js
```

El servidor no requiere un paso de compilación ni instalación de dependencias de npm.

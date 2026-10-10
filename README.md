# Sistema Punto de Venta

Sistema de punto de venta local para Windows, construido con Node.js y SQLite. Permite registrar ventas, controlar productos e inventario y consultar tickets desde la computadora principal o desde otros dispositivos conectados a la misma red local.

## Requisitos

- Windows.
- Node.js 22.13 o posterior. El servidor usa `node:sqlite`, incluido en Node.js; no requiere instalar dependencias de npm.
- Para usar celulares o tabletas, los dispositivos deben estar conectados a la misma red Wi-Fi que la computadora que ejecuta el servidor.

## Instalación

1. Descarga o clona este repositorio en `Documentos\SistemaPOS` dentro de tu carpeta de usuario de Windows.
2. Ejecuta `INSTALAR.bat` y sigue las instrucciones. El instalador instala Node.js si hace falta, crea el acceso directo del escritorio y configura el firewall de Windows para permitir conexiones a los puertos 3000 (POS) y 3001 (cocina).

   Como alternativa, abre `INSTALAR-PowerShell.txt`, copia su contenido en PowerShell y ejecútalo. Este instalador también espera encontrar el proyecto en `Documentos\SistemaPOS`.

La instalación **no inicia el servidor ni configura el inicio automático con Windows**. Si existe un acceso directo antiguo de Punto de Venta en la carpeta Inicio de Windows, el instalador lo elimina.

## Iniciar y detener

- Para iniciar el sistema, abre **Punto de Venta** desde el escritorio. Esto ejecuta `INICIAR.bat` y abre la aplicación en el navegador.
- Mantén abierta la ventana del servidor mientras uses el punto de venta.
- Para detener el sistema, cierra la ventana del servidor.
- El POS escucha en el puerto `3000` y la pantalla de cocina en el `3001`. Ambos servidores se inician juntos. Si el POS ya está ejecutándose, el acceso directo abre el sistema existente en lugar de iniciar otra instancia.

En esta computadora, abre <http://localhost:3000>. Para acceder desde un celular o tableta, usa la dirección de red local que muestra el servidor, con el mismo puerto (por ejemplo, `http://192.168.1.50:3000`).

### Acceso al módulo de cocina

El POS y cocina son dos pantallas separadas: el POS se abre en el puerto `3000` y cocina en el puerto `3001`. Al iniciar **Punto de Venta**, ambos servidores arrancan juntos. En la computadora principal, abre <http://localhost:3001>; desde otro dispositivo conectado a la misma red Wi-Fi, abre la dirección de cocina que muestra el servidor, por ejemplo `http://192.168.1.50:3001`.

Antes de iniciar sesión en cocina, el administrador debe crear una cuenta propia para cada cocinero:

1. Entra al POS en <http://localhost:3000> con un usuario administrador.
2. Abre **Usuarios** y pulsa **Nuevo usuario de cocina**.
3. Escribe el nombre, asigna un PIN de 4 a 8 números y guarda el usuario.
4. Abre la pantalla de cocina en el puerto `3001` e inicia sesión con ese PIN.

Las cuentas de cocina son independientes de las cuentas del POS. No hay un PIN de cocina predeterminado; un PIN no puede compartirse entre una cuenta del POS y una de cocina.

En **Corte de caja**, el botón **Cerrar caja y reiniciar historial de cocina** cierra el periodo del día e inicia uno nuevo para el historial de cocina. Solo el administrador puede cerrar caja. Imprimir el reporte no cierra la caja. El cierre no borra ventas ni reportes; conserva los registros en la base de datos.

## Usuarios iniciales

| Rol | PIN inicial |
| --- | --- |
| Administrador | `1234` |
| Vendedor | `1111` |

Cambia estos PIN en **Usuarios** después de la instalación. Los vendedores pueden registrar ventas y consultar sus ventas; el administrador también puede administrar productos, clientes, usuarios y ajustes, y consultar los cortes de caja. Las cuentas de cocina se crean por separado, siguiendo los pasos de **Acceso al módulo de cocina**.

## Funcionalidades

- Búsqueda de productos y lectura de códigos de barras USB o Bluetooth.
- Registro de ventas en efectivo, con tarjeta o por transferencia.
- Creación automática de una orden para cocina al cobrar cada venta.
- Módulo independiente de cocina en el puerto `3001`, con cuentas y PIN administrados desde **Usuarios**. Las órdenes se separan en preparación, listas y retiradas; las retiradas desaparecen de activas después de cinco minutos. El historial muestra las ventas de hoy desde el último cierre e indica cuántas órdenes atendidas hay en el periodo.
- Avisos sonoros diferentes al recibir una orden y al marcarla como lista. Pulsa **Probar sonido** en la pantalla de cocina para confirmar que se escucha y habilitar los avisos en el navegador; las órdenes que lleguen mientras el sonido está bloqueado quedan pendientes.
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
│   ├── cocina.html           Pantalla independiente para cocina
│   ├── cocina.js             Inicio de sesión y órdenes de cocina
│   └── cocina.css            Estilos de la pantalla de cocina
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
node --check public\cocina.js
```

El servidor no requiere un paso de compilación ni instalación de dependencias de npm.

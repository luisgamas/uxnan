# 02g — Hosts remotos por SSH

> **Estado:** en construccion. Lo implementado se marca como tal en cada seccion;
> el resto es la direccion acordada, no codigo existente.
> Identidad de destino y fencing: ver [`02a`](02a-system-architecture.md) §2.9.

---

## 1. El modelo: UI local, ejecucion remota

Un **host remoto** es otra maquina del usuario a la que el ADE se conecta por
SSH. El trabajo ocurre **alli**: los agentes corren en el host, con los CLIs que
ese host tiene instalados y con las credenciales de ese host. El ADE es la
superficie de control.

```
Maquina del usuario                        Host remoto
+----------------------------+            +------------------------------+
| uxnandesktop               |            | shell, git, node             |
|  shell de tres paneles     |    SSH     | CLIs de agente instalados    |
|  terminal (xterm.js)       |<--------- >| el codigo del proyecto       |
|  paneles git / archivos    |  1 conexion| los procesos que arranca el  |
|  navegador integrado       |  N canales | agente (dev server, tests)   |
+----------------------------+            +------------------------------+
```

**La alternativa descartada** —agente local contra un filesystem remoto
montado— no se implementa: la herramienta Bash del agente ejecutaria build,
tests y git **en la maquina del usuario** contra un montaje de red, que es lo
contrario de la razon por la que alguien se conecta a una maquina mas potente.
Ademas, un turno de agente lee cientos de archivos y cada `stat` seria un viaje.

## 2. Clase de confianza

Un host SSH es **"mi maquina, mi cuenta"**: una sesion vale exactamente lo que
vale la shell de ese usuario. Esta capa **no** promete un techo de permisos
impuesto desde el otro lado — eso es un diseno distinto (un worker propio con
capacidades acotadas) y fingirlo en la interfaz seria mentir.

Lo que si se garantiza es que el trabajo aterriza en la maquina que el usuario
quiso: el fencing de mutaciones de `02a` §2.9.

## 3. Secretos: ninguno se guarda

El registro de un host guarda alias, hostname, puerto, usuario y una
**referencia** a un fichero de identidad. Nunca una llave, nunca una contrasena.
Los aportan el agente SSH del sistema, el fichero de llave en disco y, si hace
falta, un prompt que vive solo en memoria durante la sesion.

`ForwardAgent` es la pieza que evita copiar nada: permite que git **en el host**
use las llaves que sostiene el agente **aqui**, sin que una llave privada salga
de esta maquina.

## 4. Configuracion SSH del usuario — IMPLEMENTADO

Dos trabajos separados, con exigencias muy distintas
(`src-tauri/src/ssh/config.rs`):

| Trabajo | Como | Por que asi |
|---|---|---|
| **Enumerar** alias (`Host`, siguiendo `Include`) | escaneo propio que entiende exactamente dos palabras clave | solo hacen falta candidatos para un selector; los patrones con comodin (`Host *`) se saltan porque son valores por defecto, no hosts |
| **Resolver** un alias a sus valores efectivos | `ssh -G <alias>` | reimplementar la precedencia de OpenSSH (`Match`, orden de patrones, canonicalizacion) es como acabar conectando a un sitio distinto del que conectaria el `ssh` del propio usuario. `ssh -G` viene con Windows, macOS y Linux |

Detalles que el escaneo cubre: ambos separadores (`Host x` y `Host=x`), varios
alias por linea, comentarios, `Include` relativo/absoluto/con `~` y con globs,
ciclos de `Include` (limite de profundidad + visitados), duplicados (gana la
primera aparicion, igual que el first-match-wins de OpenSSH) y un tope de
resultados. Un fichero ausente es una lista vacia, no un error.

Del `ssh -G` se levantan solo los campos sobre los que el ADE actua; el literal
`none` que OpenSSH imprime para `proxycommand` / `proxyjump` / `identityagent`
se trata como "sin valor" (ejecutar un comando llamado `none` seria un fallo
desconcertante en el momento de conectar).

Comandos: `ssh_config_hosts` y `ssh_config_resolve`. Ambos de solo lectura y sin
conexion alguna.

## 5. Transporte — decidido, no implementado

- **Cliente en proceso, una conexion y N canales.** El cliente OpenSSH de
  Windows no implementa `ControlMaster`, asi que lanzar `ssh.exe` por operacion
  significaria un handshake completo por comando. Prohibido.
- **`ssh` del sistema como plan B declarado por host**, para los casos que un
  cliente en proceso no cubre (GSSAPI, ciertos `ProxyCommand`), anunciando que
  capacidades se pierden en ese modo.
## 5.0 Handshake y generacion de conexion — IMPLEMENTADO

`src-tauri/src/ssh/conn.rs`. Establece el TCP, corre el handshake SSH y aplica
§5.1. Dos propiedades que definen el resto:

**A un host no verificado no se conecta, ni siquiera para preguntar.** Si
`known_hosts` no dice nada, el handshake se **rechaza** y el llamador recibe la
huella para mostrarla; confiar es un acto aparte y explicito del usuario, tras el
cual se conecta de nuevo. Completar la conexion y preguntar despues significaria
que ya se hablo con un posible man-in-the-middle.

**Cada conexion lleva una generacion** (contador monotono, nunca reutilizado).
Es lo que `target::check` compara: una operacion preparada antes de una
reconexion no puede ejecutarse despues de ella — mismo host, conexion nueva, y
posiblemente otro directorio de trabajo y otros procesos vivos.

Un rechazo por clave de host **no es un error de transporte**: es una variante
del resultado, porque el llamador tiene algo que enseñar y quiza una accion que
ofrecer. Los errores quedan para lo que de verdad lo es (inalcanzable, timeout,
fallo de protocolo).

Validado en vivo contra un `sshd` real (tests `--ignored` en el modulo): host
desconocido rechazado con huella utilizable, la clave registrada verificando en
la siguiente conexion, y una clave distinta reportada como *cambiada* con ambas
huellas. La huella que calculamos coincide con la de `ssh-keygen -lf`.

Falta: autenticacion.

## 5.1 Verificacion de host key — LOGICA IMPLEMENTADA

`src-tauri/src/ssh/hostkey.rs`. Es la unica decision de esta capa que no tiene
valor por defecto seguro: equivocarse no es una funcion rota, es un
man-in-the-middle. Por eso devuelve **cuatro veredictos**, nunca un booleano:

| Veredicto | Cuando | Que hace la app |
|---|---|---|
| `Trusted` | la clave exacta ya esta en `known_hosts` | conecta |
| `Unknown` | no hay nada para ese host | pregunta al usuario (TOFU) y **no escribe nada** hasta que confirme |
| `Changed` | hay clave para ese host y **no** es esta | rechaza; lleva la huella almacenada para poder mostrar ambas |
| `Revoked` | entrada `@revoked` | rechaza y no ofrece confiar |

`Unknown` y `Changed` estan separados a proposito: "no conozco este host" y "la
clave de este host no es la que tengo" son sucesos distintos y colapsarlos seria
el fallo. **No existe modo "ignorar host key"**, ni siquiera tras un ajuste.

Detalles del formato que se respetan: patrones separados por comas, negaciones
(`!host`), forma `[host]:puerto` para puertos no estandar (una clave no se
hereda entre puertos), lineas `@cert-authority` **saltadas** —leerlas como la
clave del host produciria una falsa alarma de clave cambiada— y entradas
**hasheadas** (`|1|salt|hmac`, HMAC-SHA1) que `HashKnownHosts yes` genera; sin
soportarlas, un usuario con fichero hasheado veria todos sus hosts como nuevos.

La logica trabaja sobre el blob de la clave, no sobre tipos de la libreria SSH:
se prueba sin conexion y una actualizacion de la libreria no puede cambiarla en
silencio. La huella `SHA256:…` se contrasta en tests contra la que calcula la
propia libreria, porque si divergiera, la que se ensena al usuario para comparar
no valdria nada.

Falta: llamarla desde el callback del cliente y la confirmacion TOFU en la UI.

## 5.2 Autenticacion — IMPLEMENTADA

`src-tauri/src/ssh/auth.rs`. Orden: **agente del sistema primero**, luego los
ficheros de identidad que la configuracion resuelta del host señala. El orden no
es cosmetico: el agente sostiene llaves que el usuario ya desbloqueo, asi que
probarlo primero es lo que evita que conectar a varios hosts se convierta en
varios prompts de passphrase.

**Ningun secreto se guarda.** Una credencial es una *referencia* —"el agente" o
"la llave en esta ruta"—; la passphrase vive en memoria durante un intento y no
se escribe en ningun sitio. La etiqueta de una credencial (la que va a logs y
UI) nunca incluye la passphrase, y hay un test que lo exige.

Resultados tipados, no un booleano:

| Resultado | Significa | Que hace la UI |
|---|---|---|
| `Success { method }` | autenticado, y **con que** credencial | puede decir por donde entro |
| `NeedsPassphrase { path }` | la llave esta cifrada y no habia passphrase (o era incorrecta) | la pide y reintenta **esa** credencial |
| `Failed { attempted }` | todo lo ofrecido fue rechazado, con la lista en orden | mensaje concreto, no "fallo la autenticacion" |
| `NoCredentials` | no habia nada que ofrecer | ofrece configurar una llave |

Dos decisiones que evitan diagnosticos equivocados:

- Una llave cifrada **detiene** la cadena. Seguir probando reportaria "fallo la
  autenticacion" para una llave que quiza es la correcta, y mandaria al usuario
  a depurar el problema equivocado.
- Las rutas de identidad que **no existen se descartan**, no se intentan:
  `ssh -G` lista los defaults de OpenSSH existan o no, y probar cada ausente
  convertiria un "no tienes credenciales" en una lista de fallos sin sentido.

Un certificado OpenSSH presente en el agente se **salta**: es otro metodo de
autenticacion, con sus principales y su validez, y ofrecerlo como si fuera una
llave suelta fallaria de una forma que parece una llave rechazada.

Windows habla con el agente por named pipe de OpenSSH; el resto por
`SSH_AUTH_SOCK`. Validado en vivo contra el `sshd` local: el intercambio
completo ocurre y una llave no autorizada vuelve como rechazo limpio nombrando
lo que se ofrecio. Falta una corrida con una llave cargada en el agente.

## 6. Que funciona y que no en un contexto remoto

| Capa de estado de agente (`02d`) | Remoto |
|---|---|
| Capa 2 — titulo / OSC | **Funciona sin trabajo extra**: viaja en el stream de bytes del PTY |
| Capa 1 — hooks HTTP | Requiere tunel inverso + instalar los reporters en el host. Fase posterior |
| Capa 3 — deteccion de proceso | Requiere sondeo remoto de procesos. Fase posterior |

Regla de honestidad para la interfaz: lo que no se puede medir en remoto se
marca **"no disponible en este entorno"**. Jamas se rellena con el dato local.

## 7. Fases

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Identidad de destino y fencing (`02a` §2.9) | **Hecho** |
| 1 | Registro de hosts, conexion, inventario, PTY remota, lanzador | **En curso** — configuracion SSH hecha |
| 2 | Estado preciso (tunel inverso + reporters remotos) | Pendiente |
| 3 | Archivos, git y worktrees remotos | Pendiente |
| 4 | Puertos detectados, forward y vista previa en el navegador integrado | Pendiente |
| 5 | Continuidad y recursos remotos | Pendiente |
| 6 | Que el movil vea tambien los destinos (solo contrato aditivo) | Pendiente |

## 8. Fuera de alcance (con motivo)

- **Contenedores y devcontainers.** Un entorno declarado por el usuario que
  imprima un destino SSH entra por la misma puerta que un host; no hace falta
  arquitectura nueva para ello.
- **Sandboxes.** Cada CLI de agente trae el suyo o ninguno (y en Windows nativo
  casi ninguno aplica), asi que el ADE no puede prometer un aislamiento
  uniforme sin mentir. Lo que si puede es exponer y explicar el de cada agente.

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

## 3. Secretos: ninguno se escribe

El registro de un host guarda alias, hostname, puerto, usuario y una
**referencia** a un fichero de identidad. Nunca una llave, nunca una contrasena.
Los aportan el agente que nombra la configuracion del host, el fichero de llave
en disco y lo que la persona escribe cuando se le pide.

Lo que la persona escribe —contrasena, passphrase— se guarda **en memoria hasta
que se cierra la app** (`ssh/secrets.rs`, borrado de memoria al reemplazarse o
soltarse), para que una conexion caida vuelva sola en vez de volver a preguntar.
Nunca se escribe en disco ni en un log ni viaja a la interfaz; uno rechazado se
olvida al instante. Las respuestas a un segundo factor **no se guardan nunca**:
un codigo de un solo uso no se puede repetir.

`ForwardAgent` es la pieza que evita copiar nada: permite que git **en el host**
use las llaves que sostiene el agente **aqui**, sin que una llave privada salga
de esta maquina. Cada canal de sesion pide el reenvio, y un canal de agente que
el host abre hacia nosotros solo se acepta en una conexion que lo pidio.

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

**Se resuelve en cada conexion**, no una vez al añadir el host: un cambio en
`~/.ssh/config` entra en la siguiente conexion, como en `ssh`. Un host escrito a
mano se resuelve como lo haria su linea de comandos (`ssh -p … -l … -J … host`),
asi que hereda los `Host *` del usuario; lo escrito gana, porque las opciones de
linea de comandos siempre ganan. De un host importado se guarda una **copia**
para la interfaz, que se refresca al conectar; solo su etiqueta se edita en la
app (`ssh_host_update`), porque el resto viene del fichero.

Campos sobre los que se actua: `HostName`, `Port`, `User`, `IdentityFile`,
`CertificateFile`, `IdentityAgent` (`none` se conserva: significa *ningun
agente*), `IdentitiesOnly`, `ForwardAgent`, `ProxyJump`, `ProxyCommand`,
`HostKeyAlias`, `UserKnownHostsFile`, `GlobalKnownHostsFile` y
`StrictHostKeyChecking` (que `ssh -G` imprime como `true`/`false`, no `yes`/`no`).
Si `ssh` no puede ejecutarse en esta maquina, el registro es todo lo que hay y se
usa tal cual, sin ruta por bastiones.

Comandos: `ssh_config_hosts` y `ssh_config_resolve`. Ambos de solo lectura y sin
conexion alguna.

### 4.1 La ruta: bastiones y `ProxyCommand` — IMPLEMENTADO

`src-tauri/src/ssh/dial.rs`. La ruta a un host es una lista de saltos, bastiones
primero y el host al final. `ProxyJump` (uno, una cadena `a,b`, y bastiones con
su propio `ProxyJump`, con control de ciclos y tope de 8 saltos) se recorre
**dentro del proceso**: cada bastion es una conexion SSH propia —su propia
verificacion de clave, su propio login— y el siguiente salto es un canal
`direct-tcpip` abierto **por el bastion**, que lleva una sesion SSH completa.
Por eso un nombre que solo el bastion resuelve funciona, y funciona en Windows
sin un proceso por salto. `ProxyCommand` lleva la conexion por las tuberias de un
proceso hijo, por la shell como `ssh` lo ejecuta, con `%h %p %r %n %%`
expandidos; su stderr va al log.

Cada salto puede detenerse por la persona y el resultado dice **cual**: "edge (de
camino a build-box) pide una contrasena". Los secretos se guardan por identidad
de salto (`usuario@host:puerto`), asi que un bastion compartido por dos hosts se
pregunta una vez y su contrasena no se ofrece a nadie mas. Un segundo factor
**pausa** el intento con la conexion abierta (`ssh_host_answer`, `ssh_host_cancel`,
caduca a los 3 minutos) y continua sobre esa misma conexion.

## 5. Transporte — IMPLEMENTADO

- **Cliente en proceso, una conexion y N canales.** El cliente OpenSSH de
  Windows no implementa `ControlMaster`, asi que lanzar `ssh.exe` por operacion
  significaria un handshake completo por comando. Prohibido. Medido: ocho
  canales concurrentes cuestan 1.5 veces lo que uno (§5.3).
- **`ssh` del sistema como plan B declarado por host** — para los casos que un
  cliente en proceso no cubre (GSSAPI, ciertos `ProxyCommand`), anunciando que
  capacidades se pierden en ese modo. **Pendiente**: hoy solo existe el cliente
  en proceso; el plan B esta decidido y no implementado.
- **Verificacion de host obligatoria**, sin modo para saltarla (§5.1).

### Sub-secciones

| | Que cubre | Estado |
|---|---|---|
| §4.1 | la ruta: bastiones (`ProxyJump`) y `ProxyCommand` | implementado |
| §5.0 | handshake, veredicto de clave, generacion de conexion | implementado |
| §5.1 | la decision sobre `known_hosts` | implementado |
| §5.2 | autenticacion (agente, llaves, certificados, contrasena, segundo factor) | implementado |
| §5.3 | comandos como canales, su coste medido, el candado y que shell se usa | implementado |
| §5.4 | registro de hosts y lapidas | implementado |
| §5.5 | sesiones vivas y su superficie de comandos | implementado |
| §5.6 | inventario del host | implementado |
| §5.7 | terminal remota, keepalive y caidas | implementado |
| §5.8 | explorar carpetas, por el motor | `browse` en el motor |
| §5.9 | un proyecto que vive en el host | implementado |
| §5.10 | ficheros del host, servidos por su motor | `commands::machine_for`, `uxnan-host/src/files.rs`, `fsRouter.ts` |
| §5.10b | git del host, servido por su motor | `uxnan-host/src/repo.rs`, `agent_socket.rs` |
| §5.10c | Cambios e Historial del host | el motor, `gitRouter.ts` |
| §5.10d | Crear/renombrar/duplicar/borrar en el host | el motor, `fsRouter.ts` |
| §5.10e | Buscar en el proyecto del host | el motor, `fsRouter.ts` |
| §5.10i | Worktrees del host | `worktreeloc` en el motor, `services::worktree` |
| §5.10f | Avisar de una sesion caida | `commands.rs`, `hosts.svelte.ts` |
| §5.10g | Presupuesto de canales | `ssh/conn.rs` |
| §5.10h | Diff de imagenes y borrador con IA | `ssh/conn.rs`, `aicommit.rs` |
| §5.12 | Escalera de reconexion | `ssh/conn.rs`, `commands.rs` |
| §5.13 | El inventario en la interfaz | `HostsSettings.svelte` |
| §5.14 | Puertos del host: detectarlos, traerlos y verlos | `ssh/forward.rs`, `ports` en el motor, `portscan.rs` |
| §5.16 | El motor del host: terminales que sobreviven a la conexion | `crates/uxnan-host`, `ssh/engine.rs`, `ssh/terminals.rs` |
| §5.15 | Como se prueba contra un host de verdad (y contra un servidor en proceso, §5.1–§5.2) | `ssh/testhost.rs`, `ssh/testserver.rs` |
| §5.11 | lo que queda, y la decision sobre el ayudante | — |

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

Validado en vivo (tests `--ignored` en el modulo), primero contra el `sshd` de la
propia maquina y despues **contra un host remoto real a traves de una red
privada tipo tailnet**: host desconocido rechazado con huella utilizable, la
clave registrada verificando en la siguiente conexion, y una clave distinta
reportada como *cambiada* con ambas huellas. Las dos huellas que calculamos
coinciden con las de `ssh-keygen -lf`. El host remoto se elige con la variable
`UXNAN_SSH_TEST_HOST=<host[:puerto]>`, de modo que la prueba no depende de
ninguna maquina concreta.

La autenticacion es el paso siguiente y vive aparte, en §5.2.

## 5.1 Verificacion de host key — IMPLEMENTADO

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

**Que ficheros y bajo que nombre.** Se leen todos los `UserKnownHostsFile` y
`GlobalKnownHostsFile` que da `ssh -G`, y la clave se busca bajo `HostKeyAlias`
cuando lo hay; una clave confirmada se escribe en el **primer** fichero de
usuario, nunca en uno global. `StrictHostKeyChecking`: `ask` pregunta; `yes`
muestra la huella y no ofrece confiar; `accept-new` (y `no`, leido igual) registra
una clave nueva sin preguntar y lo deja en el log. Ningun valor deja pasar una
clave **cambiada**.

**Anti-downgrade.** El handshake pide primero los tipos de clave que ya estan
registrados para ese host (`hostkey::recorded_algorithms`). Sin eso, un impostor
que solo tenga, por ejemplo, una clave RSA haria que un host con su ed25519
registrada presentara un tipo sin entrada — que parece un host nuevo y gana un
dialogo amable en vez de la alarma que merece.

**Rotacion guiada.** Ante `Changed` no se envia ninguna credencial. Si la persona
confirma que la maquina se reinstalo, `ssh_host_replace_key` saca **solo** las
entradas de ese nombre, puerto y tipo de los ficheros de usuario (con copia previa
en `known_hosts.old`, como `ssh-keygen -R`) y registra la clave presentada, la
que vio este proceso y nunca una que viajo por la interfaz. Una entrada vieja en
un fichero global no se toca desde aqui.

Cableado: el callback del cliente la consulta en cada handshake, y la confirmacion
TOFU vive en Ajustes -> Hosts. Probado en cada `cargo test` contra un servidor
SSH dentro del proceso de pruebas (`ssh/testserver.rs`).

## 5.2 Autenticacion — IMPLEMENTADA

`src-tauri/src/ssh/auth.rs` (`Authenticator`). El orden decide cuantas veces se
interrumpe a la persona:

1. llaves que la configuracion nombra **y que el agente ya sostiene**;
2. llaves que la configuracion nombra y que abren sin preguntar (sin cifrar, o
   desbloqueadas antes en esta sesion);
3. el resto de llaves del agente, salvo `IdentitiesOnly yes` — sin ese limite,
   un agente lleno gasta los `MaxAuthTries` del servidor en llaves ajenas;
4. solo entonces una llave cifrada que nadie desbloqueo: es lo unico que obliga
   a parar y pedir su passphrase (`NeedsPassphrase { path, wrong }`).

OpenSSH pide esa passphrase en cuanto encuentra la llave, aunque una del agente
mas abajo hubiera servido; pedirla al final hace que un agente que funciona
nunca cause un prompt. El agente es el que nombra `IdentityAgent` (un socket,
`SSH_AUTH_SOCK`, o `none`); en Windows, el named pipe de OpenSSH. Los
certificados (`CertificateFile`, `<llave>-cert.pub`, y los que sostiene el
agente) se ofrecen con su llave.

**El intercambio abre con un intento `none`.** Es como SSH pregunta *"¿que
aceptas?"*: evita ofrecer llaves a un host que solo toma contrasena y, sobre
todo, decir "fallo la autenticacion" cuando la respuesta real es "esta maquina
quiere una contrasena y a nadie se le ha pedido una".

**Segundo factor y exito parcial.** keyboard-interactive puede preguntar
cualquier cosa; sus preguntas llegan a la persona tal como el servidor las
mando, con eco donde el servidor lo permite (un codigo) y oculto donde no
(`NeedsAnswers(Challenge)`), y la conversacion espera en la misma conexion. Solo
un unico prompt oculto que se lee como contrasena se responde por la persona,
con la que ya dio, y una sola vez: repetirla en el siguiente seria quemar un
intento de OTP. Un servidor configurado para pedir llave **y** codigo
(`AuthenticationMethods publickey,keyboard-interactive`) acepta la llave con
"falta algo" y el intercambio sigue con lo que aun pide, en vez de reportar la
llave como rechazada. Tope de 8 rondas.

Resultados tipados, no un booleano:

| Resultado | Significa | Que hace la UI |
|---|---|---|
| `Success { method }` | autenticado, y **con que** credencial | puede decir por donde entro |
| `NeedsPassphrase { path, wrong }` | una llave configurada esta cifrada y nada mas sirvio; `wrong` = la dada no la abrio | la pide, diciendo si la anterior fallo |
| `NeedsPassword { attempted }` | el host acepta contrasena y no teniamos ninguna | pide contrasena, diciendo tambien que se rechazo |
| `NeedsAnswers(challenge)` | el servidor pregunto algo que solo la persona sabe | muestra sus preguntas; la conexion espera |
| `Failed { attempted }` | todo lo ofrecido fue rechazado, con la lista en orden | mensaje concreto; la contrasena dada se olvida |
| `NoUsableMethod` | el host no acepta nada que podamos ofrecer | lo dice tal cual, no como rechazo |

**La contrasena es el camino que hace posible una primera conexion sin preparar
nada en la maquina remota** — sin generar llave, sin tocar `authorized_keys` —, y
para la mayoria de la gente esa es la diferencia entre "conecte" y "lo deje".

Las rutas de identidad que **no existen se descartan**, no se intentan: `ssh -G`
lista los defaults de OpenSSH existan o no.

**Validado en cada `cargo test`** contra un servidor SSH dentro del proceso
(`ssh/testserver.rs`, `ssh/transport_tests.rs`): contrasena y codigo en dos
rondas, llave con exito parcial y codigo, bastion con su propia contrasena, llave
cifrada con passphrase correcta e incorrecta, `IdentityAgent` y `IdentitiesOnly`
con un `ssh-agent` real, `ForwardAgent` de punta a punta (el host cuenta las
identidades del agente reenviado). Y en vivo contra un `sshd` real (tests
`--ignored`): named pipe de Windows, llave no autorizada rechazada nombrando lo
ofrecido, contrasena incorrecta como rechazo y no como error de transporte.

## 5.3 Comandos como canales — IMPLEMENTADO, con una medicion que condiciona el diseño

`Connection::exec` abre un canal, ejecuta y recoge la salida. Es el primitivo del
que cuelgan el inventario, las versiones de agentes y las llamadas a git, y la
razon de ser del cliente en proceso: **cada comando es un canal sobre la conexion
que ya existe**, no otro handshake y otro login.

`stdout` y `stderr` se capturan **separados**. No es pijeria: un perfil de
PowerShell remoto que llama a `Set-PSReadLineOption` **falla** en una sesion SSH
no interactiva —no hay consola— y escribe un error. Ese ruido en stdout
corromperia lo que el llamador parsea. Observado en una maquina Windows real, no
supuesto.

Un exit code que nunca llega se queda en `None`, no en cero: un canal cerrado sin
codigo significa comando matado o conexion caida, y llamar a eso exito seria
mentir. El bucle de lectura tampoco corta en el exit status, porque puede llegar
mas salida despues.

### Ninguna shell se nombra por defecto

Lo que la app **no** decide: cual shell arranca el host. La terminal pide
`request_shell()` —"dame una shell"— y el `sshd` de esa maquina elige la suya
(`DefaultShell` en Windows, la de login en POSIX). Lo unico que se escribe es el
`cd`, en el dialecto que **el host reporto** al conectar (§5.7).

Quedaba una excepcion, y era exactamente la que un usuario nota: la sonda de
inventario ejecutaba `powershell -EncodedCommand …`, o sea **Windows PowerShell
5.1 por nombre**. En una maquina cuyo dueño instalo pwsh 7 eso arrancaba un motor
viejo *dentro* del que ya estaba corriendo. Ahora:

| Shell del host | Como se le pregunta |
|---|---|
| POSIX | el script POSIX, como antes |
| **PowerShell** | el script corre **en esa misma PowerShell**, sin nombrar interprete: el payload va en base64 y se decodifica en linea |
| cmd | hay que nombrar uno: **`pwsh` primero**, y Windows PowerShell solo como reserva |
| desconocida | se prueban los dos, que es lo que se hacia siempre — ahora solo aqui |

Y como se toma la respuesta de §5.7 en vez de probar POSIX y caer a PowerShell,
un host Windows **deja de pagar un comando fallido** antes del bueno: ~2 s menos
por conexion.

El `Invoke-Expression` de la forma en linea no es el `eval` que prohiben las
reglas: la cadena la construye y codifica este proceso desde el catalogo propio,
y cada nombre interpolado pasa antes por `safe_command`. Es literalmente lo que
hace `-EncodedCommand`, escrito a mano porque no queremos arrancar otro
interprete para conseguirlo.

Verificado contra el `sshd` de esta maquina (que arranca `cmd`, asi que toma la
via de `pwsh`) y, para la via de host-PowerShell, ejecutando el script generado
en un `pwsh` real. Lo que falta confirmar en un host cuyo `DefaultShell` sea
PowerShell es solo que `sshd` lo entrega intacto.

### El registro de sesiones no se sostiene mientras se habla con el host

`ssh_sessions` guarda **`Arc<Connection>`** y todo el mundo **clona y suelta el
candado** antes de tocar la red (`commands::session_for`). No es estilo: es el
fallo que congelo la app entera.

`RwLock` de tokio es *justo* (write-preferring): "read locks are not granted
until prior write locks". Sosteniendo el guard de lectura durante un viaje a la
red —un `exec` de ~2 s (§5.3), un `git status`, abrir SFTP— pasaba esto:

1. una lectura larga en curso sobre el host A,
2. **conectar** un host B necesita la escritura → se encola,
3. y desde ese momento **toda lectura posterior se encola detras de la
   escritura**: la lista de conectados, los paneles git, el arbol de ficheros y
   el propio dialogo de Ajustes.

Reportado desde la app tal cual: agregar un segundo host y conectarlo dejo
Ajustes girando, y borrarlo tambien. No era SSH lento; era un candado global
sostenido sobre la red. Lo sujeta un test en vivo: con un comando en vuelo, la
escritura entra en microsegundos.

**Y ningun comando remoto dura para siempre** (`EXEC_TIMEOUT`, 60 s). Una shell
ajena puede dejar de responder —un perfil esperando entrada, un filesystem
colgado— y sin tope el llamador espera algo que no va a llegar. 60 s es generoso
a proposito: lo que se descarta no es la lentitud, es el "nunca".

### Medicion, y la restriccion que impone

Host Windows remoto a traves de un tailnet:

```
un canal: 2109 ms | 8 concurrentes: 3170 ms | ratio 1.5x
```

Dos lecturas, ambas importantes:

1. **La concurrencia funciona.** Ocho canales cuestan 1.5 veces lo que uno, no
   ocho. Las aperturas solapan; el cliente en proceso hace lo que promete.
2. **Un `echo` cuesta 2.1 s.** Eso no es la red: es el `sshd` remoto arrancando
   su shell por defecto —PowerShell, con el perfil del usuario— para *cada*
   `exec`. En esa maquina el perfil ademas falla (`Set-PSReadLineOption` sin
   consola), asi que se paga el arranque y encima escribe a stderr.

**Restriccion de diseño, ya no una preferencia:** todo lo que se pueda agrupar,
se agrupa. El inventario se hace con **un solo comando** de salida delimitada por
marcadores. Diez datos en diez `exec` costarian ~21 s en un host asi; en uno,
~2 s. Es la misma tecnica que `path_env.rs` usa en local, y aqui hay un numero
que la exige.

Corolarios:

- El **doctor** deberia medir este coste por host y decirlo, porque explica por
  que ese host se siente lento y tiene arreglo del lado del usuario (poner `cmd`
  como `DefaultShell` del `sshd`, o meter una guarda rapida en su perfil). El
  doctor de hoy (§5.17) mide el primer salto y la ida y vuelta del motor, no este
  coste: sigue pendiente en `FOR-DEV.md`.
- Para trabajo repetido (por ejemplo sondear `git status`), un `exec` por vuelta
  es el patron equivocado en estos hosts. La alternativa —mantener un canal de
  shell abierto y escribirle los comandos— queda anotada como opcion para
  entonces, no adoptada ahora: complica el enmarcado de la salida y aun no hay
  un caso que lo pague.

## 5.4 Registro de hosts y lapidas — IMPLEMENTADO

`src-tauri/src/ssh/registry.rs`, funciones puras sobre los vectores de ajustes
(`AppSettings::ssh_hosts` y `removed_ssh_hosts`): la parte que puede perder datos
del usuario se prueba sin red.

**El problema.** Un proyecto guarda solo su `targetId` (`ssh:<hostId>`). Al
borrar un host, cada proyecto suyo apunta a un id que no volvera a existir; y si
se vuelve a añadir la misma maquina, recibe un id **nuevo**, asi que esos
proyectos quedan varados.

**La solucion, y aqui hay una decision.** Borrar deja una lapida con la identidad
de la maquina; volver a añadirla **reutiliza el id viejo** en lugar de crear uno
nuevo y reescribir todos los proyectos. Nada mas hay que tocar, asi que no existe
un estado a medio migrar que pueda salir mal: los proyectos nunca estuvieron
rotos, solo apuntaban a algo ausente.

El coste, dicho en voz alta: si la "misma" maquina resulta ser otra que comparte
hostname y usuario, sus proyectos vuelven apuntando a rutas que quiza no existan.
Eso se ve —una ruta que no esta— y se arregla; y una maquina genuinamente
distinta choca antes con la verificacion de clave de host (§5.1), que rechaza la
conexion.

**Identidad de una maquina** (`MachineKey`): gana el alias de `~/.ssh/config`
compartido, porque es el nombre que el usuario le da y una direccion cambia con
la red; si no hay alias en ambos lados, la terna `(hostname, puerto, usuario)`.
El usuario cuenta: dos cuentas en una maquina son dos homes, dos juegos de
credenciales y dos juegos de rutas.

Otras reglas cubiertas por tests: reimportar la config **nunca** sobrescribe un
host escrito a mano; actualizar un host conserva su id y si necesitaba prompt;
borrar dos veces no acumula lapidas; el numero de lapidas esta acotado y se poda
por antiguedad.

Cableado: `ssh_hosts_list` / `_add` / `_remove` / `_probe` / `_trust`, y la pantalla
Ajustes -> Hosts que los llama.

## 5.5 Sesion viva por host — IMPLEMENTADO

Un host sostiene **una** sesion autenticada, guardada en `AppState`, y todo lo
que corre en el —terminal, inventario, git— la comparte como canal. Es la razon
de ser del cliente en proceso, y con la medicion de §5.3 detras: cada `exec`
paga el arranque del shell remoto, pero no otro handshake ni otro login.

Conectar es idempotente: un host ya conectado se reporta, no se conecta dos
veces. Cada desenlace tiene forma propia —conectado, clave desconocida, clave
cambiada, hace falta contrasena, hace falta passphrase, rechazado, sin metodo
usable— porque cada uno manda al usuario a un sitio distinto y fallo no manda
a ninguno.

Si un host pidio algo interactivo se **persiste** (`needsPrompt`): sirve para
que un arranque posterior reconecte solo los silenciosos y deje los demas hasta
que el usuario este delante. El valor solo se aprende conectando, asi que
perderlo significa volver a preguntar por un host que ya sabiamos callado.

Comandos: `ssh_host_connect` (con `password` opcional, usado para ese intento y
nunca guardado), `ssh_host_disconnect`, `ssh_hosts_connected` —que responde
`{hostId, generation}` por sesion, porque el frontend necesita la generacion para
poder marcar una mutacion (`02a` §2.9)— y `ssh_hosts_resumable`.

**Reconectar al arrancar esta hecho** y lo decide el backend
(`ssh_hosts_resumable`): vuelven solos los hosts que no piden nada **y** cuya
clave ya esta en `known_hosts`, porque alcanzar uno desconocido solo puede acabar
en el dialogo de confianza — al lanzar la app y sin que nadie lo pida. Un host que
queda fuera no esta rechazado: conecta en cuanto el usuario lo pide.

Avisar a la interfaz cuando una sesion se cae **ya esta hecho** y vive en
§5.10f: un vigilante por sesion emite `ssh:session-ended` y la escalera de §5.12
intenta traerla de vuelta. (Esta seccion lo daba por pendiente; lo estuvo hasta
la fase 3.)

**Desde la superficie de control** (`02d` §1.6) esta misma sesion se lee y se
abre sin la interfaz: `host/list` y `host/show` describen cada maquina **por su
sesion** —conectada o no, su shell, los canales en uso contra el limite que el
host demostro (§5.10g)— y, con el motor en marcha, su version y plataforma
(`engine`) y la ida y vuelta del latido (`latencyMs`), leidos del motor que ya
corre: una lectura nunca arranca uno. `host/show` añade `engineSessions`, las
terminales que el motor tiene, tambien las que ninguna pestana muestra (§5.17).
`host/connect` abre la de un host registrado que no
la tiene, por el mismo camino que el arranque. La superficie **no acepta
credencial**: `needsPassword`, `needsPassphrase` y los tres desenlaces de clave
de host se devuelven tal cual y ahi termina, porque confiar una clave o teclear
una contrasena son actos de una persona. Alta, edicion y borrado de hosts no
tienen entrada: implican secretos y se quedan en Ajustes.

## 5.6 Inventario del host — IMPLEMENTADO

`src-tauri/src/ssh/inventory.rs`. Pregunta a un host que tiene: SO, home, git,
si hay multiplexor, y **que CLIs de agente estan instalados alli y con que
version**. Es lo que permitira que el lanzador ofrezca los agentes de esa
maquina y no los de la del usuario.

**Un solo comando**, con la salida entre marcadores. Es consecuencia directa de
la medicion de §5.3: si cada `exec` cuesta segundos porque el host arranca un
shell, diez datos en diez comandos serian diez veces la espera. Los marcadores
sirven ademas para lo otro que pasa de verdad: un perfil remoto que imprime — o
que **falla**, como el de PowerShell sin consola — no puede confundirse con una
respuesta. Misma tecnica que `path_env.rs` en local.

**Se pregunta en la shell que el host reporto** (§5.3), no probando una y cayendo
a la otra. La POSIX va con **login shell** (`sh -lc`) — sin `-l` el PATH es el no
interactivo, donde nvm/mise/fnm no existen, que es la razon numero uno por la que
un CLI remoto parece no estar instalado. La de PowerShell va con `-NoProfile
-NonInteractive`.

Con eso se cubren las cuatro familias que el usuario tiene: **Linux y macOS** por
la POSIX; **Windows** por la de PowerShell; **WSL** por la POSIX tambien, sea
porque el `sshd` de la distro escucha en su propio puerto o porque el shell del
host es `bash`. Y no se elige por lo que el host *dice ser*: un Windows cuyo
`sshd` lanza `bash` se clasifica como POSIX al conectar y se trata como tal.
Cuando la shell **no se pudo nombrar** —y solo entonces— se prueban las dos, que
es lo que antes se hacia siempre.

**El script de PowerShell viaja en base64** (UTF-16LE). El comando que se envia lo
interpreta *el shell que ese `sshd` arranca* —`cmd`, `powershell`, `pwsh` o uno
POSIX—, y cada uno trata comillas y contrabarras a su manera: escapar a mano
funciona en la maquina donde se probo y produce basura en la siguiente. No es
hipotetico — costo un listado que volvia con una ruta de **una sola contrabarra**
y cero entradas. El base64 no tiene comillas, ni contrabarras, ni espacios: al
shell exterior no le queda nada que reinterpretar.

Que lo decodifica depende de quien contesta, y es donde se dejo de nombrar una
shell (§5.3): en un host **PowerShell** el propio script se decodifica en linea
(`ssh::powershell_inline`) y corre en *esa* PowerShell, la version que sea; solo
en un host **cmd** hay que nombrar interprete, y ahi se pide `pwsh` primero y
Windows PowerShell como reserva (`ssh::powershell_command`).

Los nombres de CLI se sanean antes de entrar en la linea de comandos remota. Hoy
vienen del catalogo propio; "hoy" es la palabra que deja de ser cierta tras un
refactor, y ese string acaba en un shell ajeno.

**Medido en vivo** contra el `sshd` de una maquina Windows: 1.46 s cuando aun se
pagaba el intento POSIX fallido, y **1.6 s** ahora que se pregunta directamente en
la shell reportada — frente a los 2.1 s que costaba un solo `echo` por el shell
con perfil. Saltarse el perfil paga con creces el
viaje extra.

## 5.7 Terminal remota — IMPLEMENTADO

Dos formas, una por plataforma del host: en Linux y macOS la terminal vive en el
**motor del host** (§5.16) y sobrevive a la conexion; en un host Windows —y en un
build sin el motor para esa plataforma— es lo que describe esta seccion:

`src-tauri/src/ssh/pty.rs`. Una terminal remota es **un canal** sobre la conexion
que ese host ya tiene, con PTY y shell. Ni segundo handshake ni segundo login.

**Misma forma que la local, a proposito.** Los mismos cinco comandos
(`pty_create/write/paste_submit/resize/close`), los mismos eventos
`pty:output:{id}` y `pty:exit:{id}`, y el mismo espacio de ids. El frontend
—xterm, splits, re-parenting al mover un panel— no sabe cual le toco, y el
enrutado lo decide el backend preguntando **quien es dueño del id**, no la UI
recordandolo. Una segunda implementacion de terminal sobre la que la interfaz
tuviera que ramificar se separaria de la primera en una release.

Diferencias reales, dichas y no escondidas:

- **Cerrar termina el canal**, no garantiza matar el arbol. Un descendiente que
  se solto sobrevive. En local pasa lo mismo hoy (`pty.rs` mata al hijo directo);
  aqui se nota menos porque el proceso huerfano esta en una maquina que el
  usuario no mira.
- **No hay proceso local que inspeccionar**, asi que la capa 3 del monitoreo de
  agentes no ve estas terminales. La capa 2 (titulo/OSC) funciona intacta: lee el
  stream de bytes.

**Un solo dueño del canal.** La primera version lo guardaba tras un mutex y
dejaba que el bucle de lectura lo sostuviera mientras esperaba el siguiente
mensaje — es decir, lo sostenia todo el tiempo que el usuario no escribiera, de
modo que escribir, redimensionar y cerrar se bloqueaban hasta que el remoto
dijera algo. Una terminal que se bloquea justo cuando esta ociosa. El arreglo no
fue un cerrojo mas listo sino **un solo dueño**: una tarea posee el canal y todo
lo demas le habla por una cola. Medido: de 300 s bloqueado a 0.33 s.

**Desconectar un host termina sus terminales.** Soltar la conexion **no basta**:
un canal parado esperando salida nunca se entera de que su sesion desaparecio, y
la pestaña seguiria diciendo que esta viva contra una maquina que ya no esta. Lo
encontro un test en vivo que exigia que saltara el evento de salida — fallo la
primera vez que se escribio. Por eso existe `close_host`, y por eso se llama
**antes** de quitar la sesion, mientras todavia hay por donde despedirse.

**Un host callado no es un host caido.** Los dos timers de `conn.rs` mentian en
las dos direcciones: sin keepalive, una conexion en la que nadie tecleaba se
**segaba a los 5 minutos** —una sesion SSH no lleva nada mientras una shell
espera en su prompt— y una que si se habia caido tardaba esos mismos 5 minutos en
notarse, con sus terminales aparentando estar vivas contra una maquina ausente.
Ahora se pregunta cada **30 s** y se toleran **3** sin respuesta
(`KEEPALIVE_INTERVAL` / `KEEPALIVE_MAX_MISSED`), que es donde aterrizan los
clientes maduros: OpenSSH trae `ServerAliveInterval` **apagado**, y la guia para
editores con sesiones largas es 30–60 s con 3–5 fallos. Tambien evita que un NAT
o un firewall corte una conexion ociosa por su cuenta. Un host vivo responde
—eso reinicia ambos timers— y uno muerto se reporta en ~2 minutos.

Lo comprueba un test en vivo que **se queda quieto mas de esos 5 minutos** y
despues usa la conexion; sin el keepalive falla. Esta `--ignored` por lo que
cuesta, y hay que correrlo cuando se toque cualquiera de los dos timers.

Cuando la conexion se cae, el frontend lo sabe sin preguntar: un vigilante por
sesion emite `ssh:session-ended` (§5.10f) y la escalera de §5.12 intenta
volver. Lo que **no** sobrevive a la caida es la terminal misma: vive en un canal
de la sesion, asi que el programa que corria en ella termina en el host (§7,
fase 5).

Validado en vivo contra un `sshd` real: abrir, escribir un comando, leer su eco,
redimensionar y cerrar; crear dos veces el mismo id no abre dos terminales; y
desconectar el host hace que la terminal reporte salida.

## 5.8 Explorar carpetas del host — IMPLEMENTADO

**Lo lista el motor del host** (`Call::Browse`, protocolo 13) con el mismo
`browse::browse_dirs` que lista las carpetas de esta maquina, y devuelve las rutas
en la forma con barras normales en que la app guarda las de un host (`C:/Users/…`
en un Windows). La insignia de repositorio es el mismo `.git` existe que aqui, y
el listado avisa cuando se corta (`truncated`, 500 carpetas).

Antes iba por SFTP (`ssh/browse.rs`, borrado), que ya habia sustituido a un
script por la shell del host: 336 ms por listado por shell frente a 6,6 ms por
SFTP en loopback, y ~2,1 s por `exec` en un host real. El motor lo resuelve en una
llamada sobre su canal, sin un segundo listado que mantener. Un host donde el motor
no corre no tiene selector, igual que no tiene ficheros de proyecto (§5.10).

**Solo directorios.** Un proyecto es una carpeta; mandar miles de ficheros que
nadie va a elegir es gastar bytes y segundos en ruido. Un listado que hubo que
**cortar lo dice** (`truncated`): un selector que enseña 500 de 3.000 carpetas en
silencio es un selector que no encuentra la tuya y encima no lo admite.

**El separador y el padre los pone el host**, no esta maquina: un host Windows
explorado desde Linux tiene que devolver rutas que *ese* host pueda abrir. En la
raiz no se reporta padre, porque un "subir" que no sube es una afordancia que
miente.

**Si la carpeta es un repositorio git se le pregunta al host.** Solo el puede
responder, y adivinar mal dejaria un repositorio real con sus paneles de git
vacios para siempre. La prueba es que **exista `.git`**, no `git rev-parse`: en
un worktree o un submodulo `.git` es un **fichero**, y ademas preguntarselo a git
significaria arrancar una shell justo lo que este cambio quita. Si la pregunta
falla se responde "no": un proyecto que funciona menos sus ramas es mejor que
negarse a añadirlo. Lo cubre un test en vivo que exige la insignia sobre un
worktree de verdad.

**El listado vuelve con la forma del listado local** (`DirListing`: `path`,
`parent`, `isRepo`, `entries[]`) mas `truncated`. No es cosmetico: es lo que
permite que el selector de carpetas del host **sea el mismo componente** que el de
proyectos (`DirectoryBrowser`), con su barra de direccion, su navegacion por
teclado, sus insignias de repositorio y su boton "Añadir" por fila. Un segundo
explorador escrito aparte se separaria del primero en una release, y el usuario
tendria que aprender dos.

Lo que si es distinto, y por eso se parametriza en vez de fingirse: **no hay
watcher**. El explorador local observa el directorio abierto y se refresca solo;
pedirle eso a un host seria mantener un proceso vivo alli por cada dialogo
abierto. En remoto el boton de refrescar *es* la recarga.

Comandos: `ssh_browse_dirs` y `ssh_repo_add`. Este ultimo registra el proyecto con
`target = ssh:<hostId>` y la ruta **tal como la escribe el host**; la identidad es
el par, asi que la misma ruta absoluta en dos maquinas son dos proyectos.

Validado en vivo contra un `sshd` real: listar el home de una maquina Windows y
entrar en una de sus carpetas comprobando que la ruta devuelta es la que el host
abre, y listar un directorio de repositorios verificando que **marca como
repositorio exactamente los que lo son**.

## 5.9 Un proyecto del host seleccionado — IMPLEMENTADO

Añadir el proyecto era la mitad; la otra es que **seleccionarlo signifique la
maquina correcta** en todo lo que pasa despues.

**La clave de espacio de trabajo es el par `(maquina, ruta)`** — `workspaceKey`
en `pathid.ts`, definido en la fase 0 y **conectado aqui**. Los espacios locales
conservan su clave historica (la ruta pelada), asi que nada persistido se
reescribe; uno remoto se prefija con su destino. Sin eso, dos proyectos con la
misma ruta absoluta en dos maquinas comparten un espacio, y —lo grave— el shell
que se abre para el remoto nace aqui. Es exactamente lo que pasaba: la terminal
abria en el home de **esta** PC.

**La terminal hereda la maquina del espacio, no del sitio que la abre.**
`terminals.create()` toma el destino de la clave cuando quien llama no lo dice,
de modo que cada punto de entrada (clic en la tarjeta, `+`, split, comando
rapido, lanzador) queda correcto sin tocarlos uno a uno — y uno nuevo lo estara
por omision, que es lo unico que aguanta el paso del tiempo. La ruta del proyecto
viaja como `cwd`: en el host esa carpeta si existe.

**Lo que se lee en local se apaga, no se falsea.** Cambios, historial y GitHub
siguen resolviendose con el git de esta maquina, asi que con un espacio remoto
activo `activeLocalPath` es `null` y esas capas no corren: el panel derecho dice
en que maquina vive el proyecto y que si funciona hoy. El modo de fallo que
sustituye es peor que un panel vacio — una carpeta del mismo nombre **aqui**
contesta a todas esas preguntas, con aplomo y sobre otro repositorio.

Ficheros, rama y worktrees **ya no estan en esa lista**: los sirve el motor del
host (§5.10, §5.10b, §5.10i). Cuando el host no puede contestar, `worktree_list`
devuelve **un** espacio —la carpeta del proyecto— y la fila dice "rama sin leer"
en vez de `(detached)`: eso ultimo seria afirmar algo sobre un repositorio que
nadie abrio.

**El contador de terminales y los agentes de la tarjeta comparan claves**, no
rutas. Comparando rutas, un proyecto del host contaba cero.

**El espacio Global es el unico mixto**, y su clave no nombra maquina: ahi
conviven la terminal propia de un host y las locales. Una terminal nueva en
Global hereda la maquina de **la pestaña que estas mirando** — pulsar `+` al lado
de una terminal de un host y obtener una shell de esta PC es la unica lectura
sorprendente de `+`. Dentro de un proyecto manda el proyecto, siempre.

**Ruta o clave, indistinto en la entrada.** Los puntos de entrada de seleccion y
lanzamiento (`setActiveWorktree`, `openTerminalAt`, `launchAgentAt`) aceptan una
ruta de worktree **o** una clave de espacio, y normalizan. No es indulgencia: la
barra de pestañas sostiene la clave del espacio que muestra y la barra lateral
sostiene la ruta, y en local ambas son la misma cadena — asi que pasar la que no
era resultaba invisible hasta que un proyecto en un host las hizo distintas, y
entonces *todas* las opciones del `+` abrian una shell aqui, con la clave como
cwd.

**Al host se le pregunta que shell tiene; no se supone.** SSH no tiene "empieza
aqui": el protocolo abre una shell en el directorio por defecto y punto. La
primera version aplicaba el `cwd` con `exec` de `cd /d "..." && cmd` —sintaxis de
**cmd**— y una maquina Windows cuyo `sshd` arranca PowerShell contestaba con un
error de parametro y cerraba el canal en ~1,4 s: **toda** terminal de proyecto en
ese host vivia un segundo, mientras que una sin carpeta iba bien. Peor: la
siguiente version "portable" tampoco valia, porque el mismo usuario alterna entre
cmd, PowerShell, WSL y Git Bash en la misma maquina, y ninguna sintaxis las cubre
a todas.

`src-tauri/src/ssh/shellkind.rs` lo resuelve preguntando. **Una sonda, una vez por
conexion**, cuya *respuesta* identifica la familia:

```
echo __UXNAN_SH__ $0 %COMSPEC% __UXNAN_SH__
```

| Familia | Lo que contesta de verdad |
|---|---|
| cmd | `__UXNAN_SH__ $0 C:\WINDOWS\system32\cmd.exe __UXNAN_SH__` |
| PowerShell 5.1 / pwsh 7 | tres lineas: marcador, `%COMSPEC%`, marcador (`echo` es Write-Output y `$0` no existe) |
| Git Bash | `__UXNAN_SH__ /usr/bin/bash %COMSPEC% __UXNAN_SH__` |
| WSL | `__UXNAN_SH__ bash %COMSPEC% __UXNAN_SH__` |

Los campos van separados por **espacios, no por dos puntos**: `$0:` es un error de
sintaxis en PowerShell, que es lo que descarto la primera sonda. Cada linea de
esa tabla es una respuesta medida, y cada una es un test.

Con la familia identificada, el `cd` se teclea en la forma que esa shell entiende
(`cd '...'`, `<unidad>:` + `cd "..."`, o `Set-Location -LiteralPath`). Si la
respuesta no es reconocible **no se teclea nada**: una terminal que abre en el
home es una perdida pequeña; una que muere es una funcion rota. La clasificacion
se guarda con la sesion y se olvida al desconectar, porque una reconexion puede
encontrar la maquina configurada de otra forma.

**Hacia donde va esto.** Preguntar funciona, pero sigue siendo la interfaz
hablandole a una shell ajena. La direccion acordada para la fase 3 es **dejar de
necesitarlo**: un ayudante propio corriendo en el host coloca una terminal en un
directorio, lee ficheros y ejecuta git sin que ninguna shell intervenga — que es
el mismo camino que toman los clientes remotos maduros. `shellkind` es lo que
mantiene correcto el camino solo-SSH mientras tanto.

**Teclear el lanzamiento espera a que el host hable.** El comando del agente se
*escribe* en la shell, y el canal SSH se abre segundos antes de que la shell
remota termine de arrancar: teclear entonces parte el comando — la cabeza se la
come una shell que aun no esta, y la cola (incluido el id de sesion que uxnan
acaba de acuñar) aparece **dentro de la TUI del agente**. Una terminal remota
espera a haber recibido algo (`launchTiming.ts`), con una ventana de silencio mas
ancha que la local porque un viaje de ida y vuelta ya cuesta mas que ella; una
shell que no dice nada se teclea igualmente pasado un limite, porque un agente
que nunca arranca es peor que uno que arranca pronto.

**`pty_paste_submit` tambien tiene rama remota.** Le faltaba mientras
`pty_write`, `pty_resize` y `pty_close` si la tenian, asi que escribia al gestor
local —que no conoce ese id— y el motor de runs, la difusion de orquestacion y la
entrega a mitad de turno no hacian nada por SSH, en silencio.

**La maquina de una pestaña se persiste.** El layout guardado no la llevaba, de
modo que tras reiniciar toda pestaña remota volvia como local con la ruta de otra
maquina, y arrancaba aqui.

**El lanzamiento tambien pregunta.** La linea de comandos de un agente se
*teclea* en una shell, asi que hay que entrecomillarla con la sintaxis de la que
la va a recibir. Se hacia con la de **esta** maquina (`currentOS()`), de modo que
un escritorio Windows contra un host POSIX producia comillas de `cmd` y cualquier
argumento con un espacio aterrizaba en un panel muerto — la misma clase de error
que el `cd`. Ahora manda la respuesta del host (§5.7); si no se reconocio, se cae
al SO que declaro su inventario, nunca a un valor por defecto. Una pestaña remota
tampoco guarda ya una shell local que jamas usara.

**El lanzador ofrece los agentes del host.** La lista configurada describe esta
maquina; el host tiene los suyos, que es la razon de trabajar alli. Con
inventario, se filtra; sin inventario **no se filtra nada**, porque no haberlo
preguntado no es lo mismo que no tenerlos (`agentAvailability.ts`).

**Cerrar una pestaña no puede llevarse a su vecina.** Dos rutas reaccionan al
mismo cierre —la que lo inicia y la que atiende el evento de salida que ese
cierre produce— y ambas tocan el mismo grupo. La segunda decidia con un contador
leido *antes* de sus propios `await`: para entonces la primera ya habia quitado
la pestaña cerrada, el contador decia uno, y borraba la **region** entera. Un
espacio sin regiones no dibuja nada, asi que los dos paneles desaparecian a la
vez mientras la shell superviviente seguia viva en el host. Ahora la pestaña sale
del modelo antes del viaje al backend, y la ruta del evento solo retira una
region cuando quitar *su* pestaña es lo que la vacia. Reproducido en un test que
falla sin el arreglo.

**Ciclo de vida al log.** Las terminales remotas escriben abrir, cerrar y **por
que** terminaron (lo cerro uxnan / el host cerro el canal / se cayo la conexion),
y la interfaz escribe su lado de la misma bifurcacion. Una pestaña que desaparece
tiene tres causas indistinguibles una vez cerrada; solo el registro las separa.
Solo ids, nunca rutas ni salida.

## 5.10 Ficheros del host — IMPLEMENTADO, servidos por el motor del host

**Los ficheros de un proyecto del host los sirve su motor** (§5.16,
`crate::commands::machine_for` + `crates/uxnan-host/src/files.rs`). Hay **un solo
juego** de comandos `fs_*`, y cada uno lleva el `target` de la maquina: este
equipo, o un host, cuyo motor ejecuta alli **el mismo codigo** que la app ejecuta
en su disco (`uxnan_workspace_engine::fs`, protocolo 9, `Call::Fs`). Listar, leer,
previsualizar, guardar, crear, renombrar, duplicar, borrar y buscar se comportan
igual en las dos maquinas porque son la misma funcion, no dos implementaciones
que se parecen.

Asi fue hasta la fase 3: los ficheros iban por SFTP y la busqueda por `git` en la
shell del host (§5.10d, §5.10e en su version anterior). Funcionaba, pero eran
**dos capas** por funcion —la local y la remota— que discrepaban en los bordes:
el modo de un fichero al guardar, que cuenta como ignorado, que se puede buscar en
una carpeta que no es repositorio. Con el motor en el host eso desaparece, y la
capa remota se borro entera (`ssh_fs_*`, `ssh/search.rs` y las operaciones de
proyecto de `ssh/sftp.rs`).

**Un host sin motor no tiene ficheros de proyecto**, y se dice: los comandos
contestan que los ficheros de ese host los sirve su motor y que alli no corre. Un
host asi conserva sus terminales por un canal simple (§5.16, *Hosts donde el
motor no corre*). SFTP sigue existiendo solo para lo que tiene que llegar
**antes** que el motor: instalarlo.

**El fencing sigue en el backend** (`02a` §2.9). Toda mutacion sobre un host
—guardar, crear, renombrar, duplicar, borrar— lleva la expectativa (maquina +
generacion de conexion) y `machine_for` la comprueba **antes** de mandar nada al
motor: la misma ruta absoluta suele existir en las dos maquinas, y un borrado mal
encaminado no se puede deshacer. La expectativa la construye un solo sitio,
`src/lib/fsRouter.ts`, que ya no tiene ramas: llama a los mismos comandos con el
`target` y el backend decide la maquina.

**Borrar en un host es permanente.** En local va a la papelera del sistema; un
host no tiene papelera que la app pueda usar, asi que alli el motor desenlaza
(`fs::delete_permanently`, con la misma guarda contra la raiz del filesystem que
la papelera local) y el dialogo dice cual de las dos va a pasar.

**Una carpeta de proyecto que ya no esta.** `repos_missing` pregunta al motor del
host —si ya corre; no se arranca solo para esto— por la carpeta de cada proyecto
de ese host, y lo marca como falta, igual que uno local, solo cuando el sistema de
ficheros de esa maquina dice que no existe. Un host sin conexion, o un motor que no
contesta a tiempo, no es un veredicto: sus proyectos se quedan como estaban.

**Lo que se probo en vivo.** `a_projects_files_are_served_by_the_hosts_engine`
(en `ssh::terminals::tests::live`, que el job `windows-ssh-host` de CI ejecuta
contra un `sshd` real): crear una carpeta y un fichero con su padre intercalado,
guardar y releer, listar, duplicar, renombrar, buscar por nombre y por contenido,
un patron que no compila contestado como `Invalid`, un fichero ausente como el
error de E/S del sistema (`ErrorCode::Io` → `IO_ERROR`, el mismo codigo que daria
aqui), y el borrado. Del lado del daemon,
`a_projects_files_are_listed_saved_and_searched_on_the_host`
(`crates/uxnan-host/tests/daemon.rs`) prueba el servicio en las tres
plataformas.

### Una sesion de ficheros no dura mas que su canal

Cachear la sesion es correcto; **darla por viva, no**. Una sesion SFTP es un
canal, y un canal termina por su cuenta —el `sftp-server` del host sale, o el
canal se cierra debajo— mientras la conexion sigue perfectamente. Con la sesion
cacheada para siempre eso dejaba el panel de ficheros contestando lo mismo a cada
carpeta, de forma permanente, **al lado de terminales del mismo host que
funcionaban** (cada terminal abre su propio canal). Reportado desde la app, con
captura: el arbol en rojo y `pwsh` respondiendo a dos paneles de distancia.

Lo que se hace, y por que asi:

1. **Se observa el transporte, no el texto del error.** `WatchedStream` envuelve
   el stream del canal y marca el final en cuanto llega EOF (o el cierre del lado
   de escritura). No es un detalle de estilo: **medido en vivo**, la peticion que
   estaba en vuelo cuando la sesion muere no recibe `session closed`, no recibe
   *nada*, y falla diez segundos despues como un `Timeout` corriente. Clasificar
   por el texto del error habria leido eso como "host lento" y habria dejado el
   panel roto igual. La primera version de este arreglo se escribio *leyendo* la
   libreria y era incorrecta; el test contra un `sshd` real lo dijo.
2. **La sesion cacheada solo se entrega si sigue usable** (`sftp_for`), asi que
   el primer clic despues de que el host cierre el canal ni siquiera paga ese
   timeout.
3. **Y aun asi se reintenta una vez** (`commands::with_sftp`), porque entre
   comprobar y pedir cabe justo el caso que provoco el fallo. Solo se reintenta
   lo que es del canal: lo que **contesta el host** —no existe, sin permiso— es
   suyo y se muestra tal cual; preguntarlo dos veces solo haria esperar el doble
   para el mismo no.

**Una conexion cerrada deja de contar como conectada.** `ssh_hosts_connected`
filtra por transporte vivo y `ssh_host_connect` ya no devuelve "conectado" por
una sesion muerta: la suelta —con su shell y su sesion de ficheros— y vuelve a
conectar. Si no, la app decia "conectado" mientras nada funcionaba y pulsar
Conectar no arreglaba nada, porque el atajo de "ya hay sesion" respondia primero.

### Ver una imagen: por el mismo camino que leerla

`fs_read_data_url` con el `target` del host. Reportado desde la app:
abrir una imagen de un proyecto del host pintaba `[object Object]` en medio del
visor. Dos fallos encadenados, y el primero es el que importa:

**El visor era la unica lectura de fichero que no pasaba por el router.** El
panel de previsualizacion —imagenes, PDF y las imagenes que lleva dentro un
documento Markdown— llamaba siempre al backend local, asi que buscaba en el
disco de **esta** maquina una ruta que es de otra. Es exactamente la forma que
§5.10 dice que no se repita ("un solo sitio decide a que maquina se lee"), y
sobrevivio porque su lectura no se parece a las demas: no devuelve texto sino
un `data:` URL. Ahora `readDataUrlOn` la enruta como a todas.

**Y el error se enseñaba en bruto.** Lo que rechaza un comando es un objeto
`{ code, message }`, no un `Error`; convertirlo a texto directamente da
`[object Object]`. El visor ya usa el extractor comun, asi que un fallo dice por
que fallo. Vale la pena anotarlo: el sintoma que se ve no siempre pertenece al
fallo que hay que arreglar, y aqui habia uno de cada.

Del lado del host lo hace hoy el motor con el lector local
(`fs::read_data_url`): el tope de 25 MiB se comprueba **antes** de leer, los
bytes viajan tal cual (la misma exigencia que el diff de imagenes, §5.10h) y el
tipo se decide con el mismo olfateador, de modo que un fichero se previsualiza
—o se rechaza— igual en las dos maquinas porque es la misma funcion.

### Guardar: atomico y conservando el modo, en cualquier maquina

El motor guarda con el escritor local (`fs::write_file`): temporal en la misma
carpeta y renombrado encima, **conservando el modo** del fichero que reemplaza
(un script ejecutable sigue siendolo despues de editarlo). Esto cierra el motivo
por el que el guardado remoto escribia **en el sitio**: sobre SFTP v3 el rename
que sobrescribe no existe (`posix-rename@openssh.com` es una extension que la
libreria cliente no implementa), asi que "temporal y renombra" habria fallado en
todos los guardados salvo el primero. En el host el rename es el del sistema de
ficheros, y vale lo mismo que aqui.

**Fenced** (`02a` §2.9): `fs_write_file` con un `target` de host verifica maquina
y generacion **antes** de mandar nada. La generacion viaja al frontend en
`ssh_hosts_connected` —no solo en el informe de conexion— porque la ventana se
recarga mucho mas a menudo de lo que se conecta un host, y sin eso cada guardado
posterior a una recarga llevaria una expectativa que no emitio nadie.

| | Estado |
|---|---|
| Listar, abrir y previsualizar | **Funciona**, por el motor |
| Marcar ignorados por git (`ignored`) | **Funciona**: el motor lo pregunta a git alli (`git::ignored_flags`), igual que aqui |
| Buscar en el arbol | **Funciona** (§5.10e) |
| Refresco automatico | **Funciona**: el vigilante del motor (§5.16) |
| Guardar, crear, renombrar, duplicar, borrar | **Funciona**, con fencing |
| Un host donde el motor no corre | Sin ficheros de proyecto, y se dice; sus terminales siguen |

## 5.10b Git del host — IMPLEMENTADO, servido por el motor del host

**El git de un proyecto del host lo ejecuta su motor** (§5.16, protocolo 10,
`Call::Git(GitCall)` → `crates/uxnan-host/src/repo.rs`), con el mismo
`uxnan_workspace_engine::git` que la app ejecuta en su disco: el CLI de git para
lo que libgit2 hace a medias y la via rapida de libgit2 (`gitfast`) para estado,
diffs, numstat y log. **Un solo juego** de comandos `git_*` lleva el `target` de
la maquina y `machine_for` decide (§5.10); las mutaciones van cercadas igual que
las de ficheros.

Hasta aqui git se ejecutaba como **comandos por la shell del host**
(`ssh/git.rs`, borrado): cada argumento entrecomillado para la shell que el host
declaro, la salida entre marcadores, y el parche y el mensaje de commit subidos
por SFTP porque `exec` no tiene stdin. Funcionaba, y lo que se aprendio sigue en
el codigo del motor —`&&` se comia el marcador de fin con una rama sin upstream;
el espacio inicial de ` M README.md` no se recorta—, pero era **una segunda
implementacion de git** al lado de la local, con sus propios parsers y su propio
coste por llamada (~2 s de arranque de shell, §5.3). Con el motor: sin
entrecomillado por dialecto, sin ficheros temporales, sin marcadores, y la misma
respuesta en las dos maquinas porque es la misma funcion.

**Lo que lee una fila** es `git_repo_status` (`git::RepoStatus`): rama, cambios y
distancia con el upstream. **`isRepo: false` es el cajon honesto** —no es
repositorio, o no hay git alli—, y la UI **no** lo pinta como "sin cambios": deja
los badges como estaban, porque cero cambios y "no se pudo leer" no son lo mismo.
Lo que dice git cuando se niega viaja como `ErrorCode::Git` y se enseña con sus
palabras, como un error de git local.

**`push`, `pull` y `fetch` usan el agente que reenvia la conexion.** Un canal con
`ForwardAgent` da a lo que arranca un `SSH_AUTH_SOCK` que vive lo que esa
conexion; el motor sobrevive a las conexiones, asi que el suyo caducaria en la
primera reconexion. Cada `attach` apunta una ruta estable del directorio `run`
(`agent.sock`) al socket de **su** conexion, y el motor da esa ruta a todo lo que
arranca —su git y sus terminales—: lo que corre alli usa el agente de la ultima
conexion, como lo haria una terminal abierta por ella (`uxnan-host/src/agent_socket.rs`).
Solo Unix; en Windows el agente reenviado no tiene esa indireccion. **Probado en
vivo** contra un servidor Linux real: un push por SSH desde el host firmado con el
agente reenviado, dos veces —antes y despues de cortar y volver a conectar—, tras
comprobar que sin agente el mismo push falla
(`a_push_from_the_host_uses_the_agent_the_latest_connection_forwards`).

**Un fichero remoto se guarda en su maquina, o no se guarda.** Guardar pasaba por
el filesystem local: con la ruta de un host eso falla — o, peor, escribe un
fichero con ese nombre **aqui** mientras el editor informa de exito. Por eso fue
una guarda y no un `catch`, y por eso ahora el guardado va por SFTP con su
fencing (§5.10 → *Guardar*). La vista *Cambios* de un fichero remoto ya se
ofrece, y su marca de cambios en el margen se lee en la maquina que toque
(§5.10c); lo que no se hace nunca es ejecutar el git local sobre una ruta de otra
maquina, que es lo que sacaba un error rojo encima de un archivo abierto
correctamente. Mientras su host esta desconectado el editor lo dice y se niega,
en vez de fallar al final de un viaje de ida y vuelta.

**Y cuando el host se va, el arbol lo suelta.** Un directorio ya cargado no se
vuelve a listar (`loadDir` sale antes), asi que tras desconectar el panel seguia
enseñando las carpetas de esa maquina: sin aviso, sin pista, un arbol que era en
realidad un recuerdo. `fileTree.hostWentAway` es la contraparte de
`retryForHost` y lo devuelve al mismo estado que un arranque en frio. Se llama
desde el unico sitio que ve el conjunto vivo completo de sesiones, para que una
conexion que termine sola entre por el mismo camino que una que cierre el
usuario.

Ese hueco existia desde antes y **no se veia**: al arrancar nadie conectaba el
host, asi que el primer listado fallaba y el mensaje de "esperando" tapaba la
falta. Al reconectar los hosts solos al arrancar (§5.5, `ssh_hosts_resumable`) el mensaje dejo de
aparecer y el hueco quedo a la vista. Leccion anotada: **cuando un cambio quita
un estado de la interfaz, hay que buscar que otra cosa dependia de que ese estado
ocurriera.**

**"El host no esta conectado" es un estado, no un fallo.** Al abrir la app antes
de conectar, el arbol se quedaba con el error hasta cambiar de proyecto y volver:
nada reintentaba, porque la raiz fallida nunca entraba en el conjunto cargado.
Ahora el backend lo distingue (`AppError::NotConnected`, codigo `NOT_CONNECTED`),
el panel dice que espera, y al conectar el host el arbol se rellena solo
(`fileTree.retryForHost`).

## 5.10c Cambios e Historial del host — IMPLEMENTADO, por el motor

Las pestañas *Cambios* e *Historial* describen la maquina en la que el proyecto
vive de verdad. GitHub conserva su aviso, porque lee el repositorio de **esta**
maquina y su sesion de `gh`.

**Una peticion por lectura, en las dos maquinas.** `git_review` (`git::Review`)
devuelve de una vez los ficheros cambiados, sus lineas, la distancia y `HEAD`:
en un host cada llamada es un viaje, y el panel lo quiere todo a la vez. Aqui
cuesta lo mismo que las tres lecturas de antes, asi que no hay dos caminos.

**Toda mutacion va cercada.** Preparar, descartar, aplicar un hunk, commitear y
sincronizar llevan la `TargetExpectation` (§2.9 de `02a`) y el backend la
comprueba **antes** de enviar nada — un descarte no se puede deshacer una vez que
el host lo ha ejecutado, y la misma ruta absoluta suele existir en las dos
maquinas. El frontend se niega antes incluso de llamar cuando no puede nombrar
una conexion: mandar un cero seria una expectativa que nadie emitio.

**`fetch`, `push` y `pull` corren alli**, con las credenciales de esa maquina y
el agente que reenvia la conexion (§5.10b) —el proyecto vive en ella, luego su
remoto es alcanzable desde ella y no necesariamente desde aqui—. Un remoto que
pida contraseña falla en vez de esperar a que alguien la escriba: no hay terminal
detras.

**El borrador de commit con IA y el diff de imagenes** funcionan igual: el diff
preparado y los blobs se leen alli, y el agente corre **aqui**, donde estan su CLI
y su sesion.

**Enrutado en un solo sitio.** `gitRouter.ts` es el hermano de `fsRouter.ts` y,
como el, ya no tiene ramas: nombra la maquina y construye la expectativa. El
store del panel guarda la maquina **al lado** de la ruta, porque ninguna de las
dos significa nada sola.

**El par (ruta, maquina) sale de un solo sitio.** Los paneles leian la **ruta**
del proyecto seleccionado y la **maquina** del workspace de terminal enfocado —
dos hechos independientes que se contradicen en cuanto hay una terminal de un host
enfocada con un proyecto local seleccionado. El arbol de archivos (y luego Cambios
e Historial) le preguntaba entonces a un host por una ruta de **esta** maquina: con
el host caido salia "esperando a que el host se conecte" sobre un proyecto local, y
con el host arriba habria sido un listado o una revision de la maquina equivocada,
que es el fallo que se parece a un exito. `projects.activeReviewTarget` es el par
correcto: la maquina en la que **esa ruta** esta registrada, y el workspace solo
manda cuando habla de esa misma ruta (el unico caso que la ruta sola no resuelve:
la misma ruta absoluta registrada en dos maquinas). Ademas el estado "esperando"
es imposible en local por construccion, no solo por lo que diga el error.

Ese mensaje tenia **una segunda causa** con el mismo sintoma: el flag sobrevivia
al cambio de proyecto —`setRoot` limpiaba el error y todo lo demas, pero no el—,
asi que un host que habia estado caido dejaba su linea encima de las carpetas de
un proyecto local que se habian listado perfectamente. Se limpia al cambiar de
raiz y en cuanto un listado funciona: un arbol que acaba de listar no espera a
nadie. Leccion, la misma de siempre en esta funcionalidad: **cuando un estado se
pone, hay que decir tambien cuando se quita.**

**El refresco lo da el vigilante del motor.** El sondeo de 3 s es el git de esta
maquina; en un host el motor vigila la carpeta —tambien `.git`— y empuja el
cambio (§5.16), y el panel relee una vez cuando la rafaga se calma. El evento del
sondeo local se ignora cuando el panel mira a un host: la misma ruta absoluta
existe en las dos maquinas, y sin esa comprobacion la lista de ficheros de aqui
pisaria la revision de alli.

**Al conectar y al desconectar, los paneles reaccionan solos.** No empujando
desde el store de hosts —eso importaria `git`, que importa `app`, que importa
`hosts`: el ciclo que el registro hoja de sesiones existe para evitar— sino
leyendo ese registro desde los efectos de los propios paneles. Un host que aun no
esta arriba se dice **en silencio** ("esperando a que el host se conecte"), como
ya hacia el arbol: un toast rojo en cada arranque en frio, por un estado que la
app resuelve sola, es ruido sobre el que el usuario no puede actuar. Y cuando el
host se va, la lista se vacia y las acciones se deshabilitan, pero el mensaje de
commit a medio escribir se respeta.

## 5.10d Operaciones de fichero en el host — IMPLEMENTADO, por el motor

Crear, renombrar, duplicar y borrar, en la maquina de la que es el arbol: los
mismos `fs_*` con el `target` del host, servidos por su motor (§5.10). Los
nombres los valida **el mismo validador** en las dos maquinas
(`fs::split_new_entry_path`, `validate_bare_name`), porque es el mismo codigo:
que una ruta no pueda escapar de su carpeta importa exactamente igual en la
maquina de otro.

**Esto tapo un agujero, no solo añadio una funcion.** Antes de condicionarlos,
esos elementos del menu llamaban al filesystem **local** con la ruta de la otra
maquina. Casi siempre fallaba — pero la ruta de un host Windows (`C:/Users/…`)
puede existir tambien aqui, y entonces un renombrado o un borrado caian sobre el
fichero equivocado en el ordenador equivocado. Por eso toda mutacion lleva
fencing (§5.10).

**Borrar es permanente en un host, y la interfaz lo dice** (§5.10). Duplicar
copia bytes en el host, sin cruzar el enlace — ya no hace falta el tope que
tenia cuando el fichero entero pasaba dos veces por SFTP.

**Lo que solo puede hacer esta maquina no se ofrece** para una entrada remota:
revelar en el explorador, abrir con un editor local y registrar como proyecto
local. Y con el host desconectado, lo que cambia la maquina se deshabilita: se
puede leer lo que ya se leyo, pero no mandarle nada.

## 5.10e Buscar en el proyecto del host — IMPLEMENTADO, por el motor

Por nombre de fichero y por contenido, con `fs_search_files` /
`fs_search_content` y el `target` del host: el motor recorre el proyecto **alli**
con el mismo recorrido que aqui (el crate `ignore`, que lee `.gitignore`), y solo
vuelven los resultados. Mismo resaltado, mismos modos (mayusculas, palabra
completa, regex), mismos filtros, mismo tope; un patron que no compila vuelve
como `SEARCH_INVALID` para que el panel lo enseñe bajo el campo.

La version anterior le preguntaba a **git** en la shell del host (`git ls-files`,
`git grep`), porque SFTP no sabe buscar y el ayudante en el host estaba
descartado. Tenia dos limites que el motor quita: una carpeta que no era
repositorio no se podia buscar, y los offsets del resaltado se recalculaban aqui
porque `git grep` informa de lineas y no de columnas. Ahora la respuesta es la
misma funcion en las dos maquinas.

## 5.10i Worktrees del host — IMPLEMENTADO, por el motor

Un proyecto del host tiene sus worktrees como uno de aqui: la barra lateral los
lista, el dialogo crea uno nuevo (rama nueva o existente, base, carpeta propia
opcional) y se quitan con la misma limpieza opcional de ramas. Todo lo ejecuta el
motor alli (`GitCall::{Worktrees, Branches, WorktreeLocation, AddWorktree,
RemoveWorktree, BranchIntegrated}`) con **la misma funcion** que la app usa aqui:
la politica de ubicacion (`worktreeloc`, con su raiz gestionada, la marca de grupo
y el sufijo libre) y la creacion (`worktreeloc::create`) se movieron al motor de
trabajo, asi que `services::worktree::create` es una sola implementacion para las
dos maquinas.

**Donde cae.** La raiz gestionada es la del host (`<home del host>/uxnan/worktrees`).
La raiz personalizada **global** de Ajustes es una carpeta de **esta** maquina, asi
que en un host no se aplica; la raiz propia de un proyecto (una ruta de ese host)
si. El modo `sibling` coloca la carpeta junto al repositorio, alli.

**Cercado.** Crear y quitar son mutaciones: llevan la expectativa con la
generacion de la conexion que el usuario mira (`projects.liveExpectation`), y el
backend la comprueba en `machine_for` antes de mandar nada. Con el host caido no
se envia nada: el dialogo dice que no hay conexion. Quitar decide el cercado
**antes** de cerrar las terminales del worktree, para que un host que se fue no
deje nada cerrado a medias.

**Probado.** `a_projects_worktrees_are_listed_made_and_removed_on_the_host` contra
el daemon real; el sondeo en vivo del motor crea y quita uno en el host del job
`windows-ssh-host`.

**La limpieza de worktrees viejos tambien es del host** (`Call::Cleanup`,
protocolo 14). El motor corre alli el mismo `worktreeclean` que la app corre aqui
—movido al motor de trabajo—, sobre las raices de esa cuenta: su
`~/uxnan/worktrees`, su `~/uxnan/repos` y las raices propias de los proyectos de
ese host, que la app le pasa junto con sus rutas. Las mismas pruebas de que algo es
desechable, la misma re-verificacion al quitar, el mismo paso por la papelera de la
raiz; y nunca toca una carpeta en la que esta una terminal suya. Al arrancar, el
daemon termina de borrar lo que una ejecucion anterior dejo a medias, como hace la
app. Quitar va cercado. Probado contra el daemon real y en vivo contra un host
Linux (`a_hosts_old_worktrees_are_cleaned_up_by_its_engine`).

## 5.10f Avisar de una sesion caida — IMPLEMENTADO (fase 3, sexta parte)

`commands.rs` (`watch_session`, evento `ssh:session-ended`) + `hosts.svelte.ts`.

Todo lo de una sesion caida ya era correcto **cuando se preguntaba**: el
keepalive nota un host muerto en ~2 min (§5.5), un listado abre un canal nuevo
(§5.10), y una conexion terminada deja de contar como conectada. Sin nadie
preguntando, un host que se caia con su panel abierto seguia pareciendo
conectado hasta que el usuario hacia clic — y el clic era como se enteraba.

**Un vigilante por conexion**, que sondea una bandera **local** (`is_closed()`
del handle de russh: cero trafico) cada 2 s y avisa una vez. Es un sondeo y no
una suscripcion porque russh expone la bandera y no una notificacion; meter mano
en sus internos para ganar dos segundos ataria la app a un detalle privado de una
dependencia.

**Solo limpia su propia encarnacion.** Una reconexion guarda otra conexion bajo
el mismo id de host, asi que el vigilante compara generaciones antes de quitar
nada: el de una sesion muerta no puede llevarse por delante la viva que la
sustituyo (`ends_the_current_session`, con test).

**El evento dice *que* algo cambio, no cual es el estado nuevo.** El frontend
vuelve a leer el conjunto vivo del unico sitio que lo sabe. Dos fuentes para un
mismo hecho es como acaban discrepando.

## 5.10g Presupuesto de canales — IMPLEMENTADO (fase 3, septima parte)

`ssh/conn.rs` (`ChannelBudget`, `ChannelLease`, `open_channel`). Todo lo que
corre sobre una conexion es un canal —cada terminal, la sesion de ficheros, y
cada comando mientras dura (§5.3)— y el host limita cuantos lleva a la vez. Pasado
ese limite, la siguiente terminal fallaba con un error de libreria que se lee como
"se rompio".

**El limite no se supone.** `MaxSessions` de OpenSSH vale 10 por defecto, pero es
ajuste por host y mucha gente lo cambia: cablear un 10 seria esta app decidiendo
como esta configurado el `sshd` de otro. Se cuentan los canales y **se aprende** el
techo en el primer rechazo; a partir de ahi el mensaje nombra el numero que esa
maquina impone y donde cambiarlo.

**Dos clases de usuario, dos respuestas.** Un comando dura poco, asi que hace cola
por un hueco en vez de fallar mientras otro termina. Una terminal o la sesion de
ficheros retienen su canal mientras viven, asi que se les contesta ya —un spinner
esperando un hueco que no va a llegar es peor que una frase que nombra el limite—.
El sitio en el presupuesto se devuelve con un guard (`ChannelLease`), no con un
decremento a mano: un retorno temprano que se dejara un hueco sin devolver no se
notaria hasta que el usuario no pudiera abrir una terminal, que es justo el fallo
que esto viene a evitar.

**Medido contra un host real, no razonado**, y cazo dos cosas: el numero del
rechazo iba **uno alto** (habria mandado al usuario a subir un ajuste al valor que
ya tenia), y un host libera un canal cerrado **de forma asincrona** — un rechazo en
ese instante se estaba registrando como "esta maquina permite 1 canal", lo que
habria dejado la conexion inutil el resto de su vida.

## 5.10h Las dos ultimas piezas del panel — IMPLEMENTADO (fase 3, octava parte)

**Diff de imagenes.** `Connection::exec_bytes` + `RemoteFiles::read_bytes`. Lo
que faltaba no era git sino el transporte: `exec` convierte stdout con
`from_utf8_lossy`, correcto para todo lo que es texto y destructivo para lo que
no — un PNG leido asi vuelve como caracteres de reemplazo. La conversion es
**nuestra**, no del canal (que lleva bytes), asi que ahora hay una lectura que no
la hace. La alternativa era pedirle al host que codificara en base64, que necesita
una herramienta distinta por sistema (`base64`, `certutil`,
`[Convert]::ToBase64String`) y una redireccion cuya codificacion cambia por
shell: esto no necesita nada instalado ni sintaxis alguna. El lado comiteado sale
de `git show` con sus bytes intactos; el del working tree, por SFTP. Verificado
contra el contenedor con bytes que **no** son UTF-8 validos, comparando byte a
byte.

**Borrador de commit con IA.** El diff se lee **alli** y el agente corre
**aqui**: el CLI y su sesion son de esta maquina, y exigir un agente instalado en
cada host pondria la funcion detras de una instalacion que nadie pidio.
`aicommit::from_diff` separa "de donde sale el diff" de "quien lo resume". El
agente arranca en el home del usuario, porque el proyecto no existe en esta
maquina y el diff entero va en el prompt — el directorio es solo donde el proceso
se planta. Un CLI que exija confiar en una carpeta antes de hacer nada fallara
ahi en vez de colgarse (la ejecucion esta acotada por `GENERATE_TIMEOUT`) y el
boton lo dice.

### Lo que hacemos nosotros no necesita watcher

Reportado: descartar un cambio dejaba el editor mostrando el cambio hasta cerrar
y reabrir la pestaña. El panel estaba bien; el centro, obsoleto.

En local nadie llama a nada: el watcher del backend ve la escritura y emite
`fs:changed`, que es el mismo camino que toma una edicion hecha **fuera** de la
app. En un host no hay watcher —sondear uno por SSH seria un arranque de shell
cada pocos segundos en la maquina de otro (§5.11)— y de ahi la pestaña quieta.

Pero ese caso **no necesitaba watcher**: la app hizo el cambio y sabe cual. Ahora
lo dice ella misma tras las acciones que reescriben el arbol de trabajo
(descartar, descartar un hunk, `pull`), y **no** tras las que solo mueven el
indice (preparar/quitar): marcar un buffer a medio escribir como "cambiado
fuera" por un `git add` seria mentir. Un buffer sucio se **señala**, nunca se
sobrescribe.

El anuncio va por un registro hoja (`externalChangeRegistry`), porque el emisor
—el store de git— no puede importar el de terminales sin cerrar el ciclo
`git → terminals → files → git`. Mismo patron que `flushRegistry` y que el
registro de sesiones.

Lo que sigue necesitando preguntar es un cambio que haga **otro** en el host: un
agente trabajando en esa carpeta, un `git` en una terminal de alli. Eso si es el
precio de no tener ayudante, y esta dicho en la interfaz.

### La linea del marcador se tira entera, no solo sus saltos

Reportado desde un host Windows real cuando el contenedor Linux llevaba dias en
verde, y es la misma leccion de siempre con un disfraz nuevo.

`cmd` separa sentencias con `&`, asi que `echo __UXNAN_GIT_SEP__ & git …` **imprime
el marcador mas el espacio que va delante del `&`**. Al partir por el texto del
marcador, ese espacio quedaba al principio de la seccion y se pegaba al primer
registro del `status`: el panel le pedia al host preparar `M AGENTS.md`, que no es
un fichero, y git contestaba que no lo conoce. Como los recuentos de lineas van
indexados por ruta, dejaron de casar a la vez. **Una causa, cuatro sintomas.**

Ahora se descarta **la linea entera del marcador**, deje lo que deje la shell, y
solo se recortan saltos de linea al final — nunca espacios, porque el estado de un
cambio sin preparar *es* un espacio inicial (§5.10c). Los dos errores opuestos
viven a una linea de distancia, y cada uno tiene su test: uno con la forma que
produce `sh` y otro con la que produce `cmd`.

## 5.12 Escalera de reconexion — IMPLEMENTADO (deuda de la fase 1)

`ssh/conn.rs` (`Unreachable`, `classify_dial`) + `commands.rs`
(`reconnect_ladder`).

**Primero tipar el fallo.** Antes, no llegar a un host era un `Err` con una
cadena, asi que "esta dormido", "no existe ese nombre" y "no hay nadie
escuchando" eran indistinguibles — y llevan a acciones distintas. Ahora
`Handshake::Unreachable` lleva un motivo (`timeout` / `unknownAddress` /
`refused` / `handshake`) clasificado por el **kind** del error del sistema
operativo, no por el texto de la libreria: el texto no es contrato y cambia entre
versiones. El dialogo de conexion enseña esa frase, que nombra maquina y puerto.

**Y luego la escalera**: 2s, 5s, 15s, 30s, 60s y para. Solo para hosts que
pueden volver **en silencio** — la misma regla que el arranque
(`ssh_hosts_resumable`): sin contraseña, sin passphrase y con la llave ya en
`known_hosts`. Una escalera que abriera un dialogo de contraseña sola, minutos
despues de que el usuario se fuera de la maquina, seria peor que quedarse
desconectado.

Se detiene en cuanto reintentar no puede ayudar: un nombre que no resuelve, una
credencial rechazada, o una llave de host que cambio — este ultimo es el caso en
el que reintentar seria activamente malo, porque algo esta contestando por esa
direccion y no es la maquina en la que confiamos.

No la dispara una desconexion del usuario: el vigilante compara generaciones
(§5.10f), y `Desconectar` ya habia quitado la sesion, asi que la escalera no
arranca. La app no discute con quien acaba de desconectar a mano.

## 5.13 El inventario, en la interfaz — IMPLEMENTADO (deuda de la fase 1)

Lo que la maquina **tiene** ya se ve: Settings → Hosts muestra los agentes como
logos con `+N`, y detras el detalle completo — cada agente con **la version que
esa maquina reporto**, el sistema y el multiplexor.

Lo que **le falta** es deliberadamente *una linea y no una lista*: el catalogo
conoce 31 agentes y un host tiene un puñado, asi que enumerar el resto serian 25
filas de ruido sobre cosas que a nadie le importan. La unica ausencia que cambia
lo que uxnan puede hacer alli es **git** — sin el no hay rama, ni revision, ni
historial, ni busqueda — y eso si se dice, donde el lector ya esta mirando.

**Lo que no se hace, y por que:** "el comando para instalarlo". No existe esa
dato en ninguna parte de la app (ni siquiera para la maquina local, que solo
detecta lo que hay en el PATH), y mantener una tabla de instalacion por agente
seria justo la clase de tabla escrita a mano que se desincroniza sin que nadie
lo note. Decir que falta es verdad; decir como instalarlo seria una promesa que
no podemos verificar.

## 5.11 La fase 3 esta completa

Todo lo que esta seccion enumeraba esta hecho: ficheros (§5.10), git y su
revision (§5.10b, §5.10c), operaciones del arbol (§5.10d), busqueda (§5.10e),
aviso de sesion caida (§5.10f), presupuesto de canales (§5.10g) y las dos ultimas
piezas del panel (§5.10h). Lo unico que un proyecto remoto sigue sin tener frente
a uno local es **GitHub** —lee el repositorio de esta maquina y su sesion de
`gh`— y el **sondeo automatico**, que es una decision y no una carencia:

el watcher de git local sondea cada 3 s (`lib.rs`), y a ~2 s por `exec` (§5.3)
eso saturaria el canal para siempre. Un proyecto remoto **no tiene sondeo**: se
refresca al abrir la pestaña, al actuar y con el boton, y la interfaz lo dice en
vez de fingir un directo que no existe.

Fuera de la fase 3: los **puertos reenviados** son ya la fase 4 (§5.14), y el
**estado preciso de agentes** quedaba fuera: necesitaba algo vivo en el host
que recibiera los reportes. Llego con el motor del host (§5.16), sin tunel
inverso. La escalera de reconexion, que estaba en esta lista,
es ahora §5.12.

### La decision sobre el ayudante en el host: no para la fase 3, reabierta por las fases 2 y 5

Para ficheros, git y busqueda se decidio, con lo medido, no desplegar nada en el
host.

**Que se observo en clientes comparables.** Los que despliegan un servidor en el
host lo atan a la version exacta del cliente —cada actualizacion deja
inalcanzable lo que corria en el anterior— o lo construyen sobre un runtime que
el host tiene que traer (Node, una libc minima, compilar modulos nativos alli).
Y muchos multiplexan con `ControlMaster`, que el OpenSSH de Windows no
implementa, asi que ese transporte no es copiable aqui.

**Por que la fase 3 no lo necesito.** Cada pieza que salio de la shell le quito su
razon de ser: los ficheros van por SFTP (§5.10), el explorador tambien (§5.8) y
la sonda pregunta en la shell que el host reporto (§5.3). Lo unico que queda con
forma de shell es git — y el panel de Cambios **pide el diff por fichero al
seleccionarlo**, no todos de golpe, asi que su forma natural son comandos
sueltos: ~2 s al abrir la pestana y ~2 s por fichero abierto. Lento, no roto. Los
dos casos que parecian imposibles (stdin y binarios) los resuelve el SFTP que ya
esta abierto.

**Que coste tendria.** Un binario por arquitectura, versionado con la app, y una
clase de fallo nueva —"no pude instalar el servidor en tu maquina"— que hoy no
existe. Justo en la parte que mas se le pide a esta funcion: que sea facil.

**Que la reabre.** Las dos fases pendientes de §7 no se pueden hacer sin algo
vivo en el host: terminales que sobrevivan a una desconexion (fase 5) necesitan
un dueno de las PTY fuera de la sesion SSH, y el estado preciso de agentes
(fase 2) necesita reporters escuchando alli. La pregunta deja de ser "¿ayudante
si o no?" y pasa a ser **cual y como**: la respuesta que se perfila es el mismo
codigo de workspace que el desktop usa en local, compilado estatico (sin runtime
que el host deba traer), subido por SFTP desde el desktop (sin Internet en el
host) y con una ventana de protocolo en vez de version exacta. Es lo que se
construyo: §5.16.

## 5.15 Como se prueba esto contra un host de verdad — IMPLEMENTADO

Hasta ahora **todas** las pruebas en vivo hablaban con el `sshd` de la maquina que
las ejecuta, que en este proyecto siempre ha sido Windows con `cmd`. La mitad
POSIX de esta capa —la clasificacion de `shellkind`, el script `sh -lc` del
inventario, el `;` del script de git, las rutas SFTP que arrancan en `/`— no se
habia ejecutado **nunca**. "Funciona en cualquier SO" era una afirmacion sin
nada detras.

`docker/ssh-test-host/` es un host Linux de verdad: Debian, `sshd`, `git`, un
usuario con contraseña, un repositorio con un fichero sucio y una carpeta que
**no** es repositorio, para que la insignia del selector tenga caso negativo.
Escucha **solo en 127.0.0.1** y su contraseña es publica a proposito: no guarda
nada.

`npm run test:ssh:linux` lo levanta y corre las doce pruebas que recorren el
stack entero en esa maquina: autenticacion por contraseña, la clasificacion de
shell, el inventario, SFTP (listar, leer, guardar y **acortar**), el explorador
con su insignia, `git status` remoto incluido el caso sin upstream, la revision
completa (diff, historial, preparar, descartar y commit), las operaciones del
arbol, la busqueda, el presupuesto de canales, el diff de imagenes byte a byte y
la previsualizacion de una imagen que el host tiene. Primera
ejecucion, todas en verde: `os=linux`, `home=/home/uxnan`, `git 2.39.5`,
`shell=posix`, rama `main`.

La contraseña, y no una llave, es deliberada: no hay material que generar,
distribuir ni limpiar, y de paso ejercita el camino que toma un usuario la
primera vez.

**Lo que sigue sin cubrirse, y se dice:** un host **macOS**, y un host
**Windows** como extremo remoto — el PowerShell generado se ejecuta contra un
`pwsh` local (§5.3), que no es lo mismo que un `sshd` lanzandolo.

## 5.14 Puertos del host — IMPLEMENTADO (fase 4)

`src-tauri/src/ssh/forward.rs`, `crates/workspace-engine/src/ports.rs` (en el motor del host),
`src-tauri/src/portscan.rs`, `src/lib/state/ports.svelte.ts`,
`src/lib/components/PortsStatusButton.svelte`.

**El problema.** Un servidor de desarrollo arrancado en el host escucha en el
loopback **de esa maquina**, que es precisamente donde nada de aqui llega: el
sentido de `localhost` es que no se comparte. Sin esto, la unica forma de ver lo
que uno acaba de levantar alli era abrir el navegador *en* esa maquina.

### Como se sabe que hay un puerto: dos caminos, y la diferencia importa

| Camino | Coste | Que ve |
|---|---|---|
| **Anunciado** — la terminal imprimio su URL (`portscan.rs`) | **Cero**: esos bytes ya venian de camino a la terminal | Lo que el propio servidor dice de si mismo, en cualquier host y con cualquier shell, porque habla el *programa* y no la maquina |
| **Encontrado** — se le pregunta al motor del host (`ports::listening`, `Call::Ports`) | Una llamada al motor: en Linux lee la tabla del kernel (`/proc/net/tcp{,6}`) sin lanzar nada; en macOS `lsof` (un proceso que no es la shell de la persona recibe la tabla de `netstat` vacia, medido) y en Windows `netstat -ano`, ejecutados sin shell | Todo lo que escucha, incluido lo que nadie anuncio o lo que ya corria antes de abrir uxnan |

El primero es automatico y el segundo es un **boton**. Con el motor preguntar ya
no cuesta un arranque de shell, pero sondear seguiria siendo trabajo constante en
la maquina de otro para una pregunta que casi nunca se esta haciendo. Un host sin
motor no tiene este camino, y lo dice.

**Quitar las secuencias de escape no es cosmetico.** Vite imprime su puerto en
negrita: los bytes en el cable son `http://localhost:\e[1m5173\e[22m/`. Un
escaner que lea la salida cruda encuentra `localhost:` seguido de un escape y no
reporta **nada** — es decir, se perderia justo el servidor de desarrollo mas
extendido. Se limpian CSI y OSC y se busca sobre el texto.

**Solo cuentan URLs de verdad.** La salida de una compilacion y un stack trace
estan llenos de texto con forma de `:3000`. El escaner acepta una URL `http(s)`
sobre una direccion de loopback o comodin, y nada mas.

### El tunel

Un socket **en 127.0.0.1 de esta maquina**, nunca en `0.0.0.0`: enlazar el
comodin republicaria el servidor de otro a toda la red local, que no es algo que
nadie haya pedido al pulsar "Abrir". Cada conexion aceptada abre su canal
`direct-tcpip` y se copia en las dos direcciones.

**El mismo numero de puerto siempre que se pueda.** Una aplicacion web escribe
su propia direccion en redirecciones, cookies y URLs de recursos, asi que una
pagina servida en 5173 y abierta en 49871 se rompe de formas que parecen fallo de
la aplicacion. Si el numero esta ocupado aqui se usa otro y **se dice cual**, en
vez de sustituirlo en silencio.

**Estos canales no gastan el presupuesto (§5.10g).** `MaxSessions` limita
*sesiones* —shells, `exec`, subsistemas— y OpenSSH no se lo aplica a
`direct-tcpip`. Contarlos en el mismo cupo haria que **una sola carga de pagina**
(decenas de peticiones en paralelo) dejara al host sin terminales. Medido, no
supuesto: la prueba en vivo lleva doce conexiones simultaneas por un forward
contra un host cuyo `MaxSessions` es el diez por defecto, y las doce responden.

### Abrir el tunel no es lo mismo que alcanzar el puerto

Reportado desde un host real: la lista salia, "Abrir" abria el navegador y este
mostraba un error generico; el registro no decia nada, porque una copia que
termina bien no escribe nada y una que nunca empieza tampoco. Dos fallos
distintos con el mismo aspecto, y el usuario en medio adivinando.

**Medido contra un `sshd` de verdad: pedir un canal a un puerto donde no hay
nada NO falla.** El servidor acepta el canal y lo cierra en cuanto su propio
`connect()` falla. Asi que una comprobacion que solo mirase la apertura daria por
bueno cualquier puerto muerto — que es justo lo que hacia la primera version de
la sonda, hasta que la prueba en vivo lo dijo. Ahora la sonda abre el canal y
**espera brevemente a ver si sobrevive** (`PROBE_GRACE`), y eso ocurre **antes**
de abrir el navegador: un puerto que no responde se explica en el sitio donde se
hizo clic, no en una pagina de error que no puede saber por que.

**SSH distingue dos noes, y la interfaz tambien.** El codigo de rechazo del canal
separa `AdministrativelyProhibited` —el `sshd` de ese host no reenvia puertos, es
decir `AllowTcpForwarding no`, una opcion que su dueño puede cambiar— de
`ConnectFailed` —lo intento y nada contesto—. Reportar los dos como "no se pudo
abrir" obliga a adivinar cual de los dos es. Viajan como un `kind` estable que la
interfaz traduce, nunca como texto de protocolo.

**Y el destino no siempre es el loopback del host.** Un servicio atado a **una**
direccion de esa maquina —la interfaz de una VPN, una direccion de la LAN— no
responde en su `127.0.0.1`, asi que un tunel apuntado alli llega al silencio
aunque todo lo demas funcione. El sondeo de puertos ya sabe esa direccion
(`ListeningPort::address`, que distingue loopback, comodin y direccion concreta),
de modo que se prueba el loopback primero y, si no contesta, la direccion que el
propio host reporto. Lo que llegue a la interfaz es siempre una direccion, nunca
una palabra de shell — y nada de esto pasa por una shell de todos modos.

**"Cerrado" significa que el socket ya no esta.** Señalar al bucle de `accept`
no basta: el sistema operativo completa el handshake de lo que hay en el backlog
mientras el socket exista, asi que una conexion hecha justo despues de cerrar
seguia siendo aceptada. Lo capturo la prueba en vivo. Cerrar **aborta la tarea
que posee el listener y espera a que muera** —ese `drop` es lo que libera el
puerto— y despues corta las conexiones que aun llevaba.

### Lo que hace la interfaz, y lo que no

Un boton en la barra de estado abre un popover con los puertos de las maquinas
conectadas. **Nada se reenvia solo**: un tunel abre un socket en el ordenador del
usuario, y eso espera a su clic. Lo que llega por su cuenta es solo el
conocimiento de que el puerto existe. "Abrir" reenvia si hace falta y entrega la
URL a `openUrl`, que es el punto unico donde se decide navegador integrado / del
sistema / preguntar — de modo que la vista previa respeta la preferencia que el
usuario ya configuro.

Al desconectar un host se cierran sus tuneles: un socket que lleva conexiones
sobre una conexion que ya no existe las aceptaria hacia la nada.

## 5.16 El motor del host (`uxnan-host`) — IMPLEMENTADO para terminales

Tres crates, una sola implementacion por capa:

- `crates/workspace-engine` — el gestor de PTY que el desktop ya usaba en local
  (movido, no copiado: `crate::pty` lo reexporta), un **modelo de pantalla**
  (`vt100`) y el **vigilante de carpetas** (`watch`), que usan tanto el arbol
  local (`fswatch.rs`) como el daemon. El motor es el mismo en las dos maquinas.
- `crates/host-protocol` — tramas con longitud (control JSON, bytes de terminal
  en crudo, ping/pong) sobre **un** flujo de bytes, y un saludo que se encuentra
  en una **ventana** de versiones (`PROTOCOL_MIN..=PROTOCOL`), no en una version
  exacta: una actualizacion de la app no deja huerfanas las terminales que tiene
  un daemon de la version anterior.
- `crates/uxnan-host` — el binario del host: `version`, `attach` y `serve`.

**Despliegue** (`src-tauri/src/ssh/engine.rs`). `uname -sm` decide la build
(Linux x86_64/aarch64 musl estatico, macOS arm64/x86_64) — en Windows,
`%PROCESSOR_ARCHITECTURE%` (cmd) o `$env:PROCESSOR_ARCHITECTURE` (PowerShell)
elige entre `x86_64`/`aarch64-pc-windows-msvc`, se instala `uxnan-host.exe` y se
ejecuta como cada shell ejecuta un programa (`run_line`: `"ruta" arg` en cmd,
`& "ruta" arg` en PowerShell, con `\`); se sube por el SFTP que
el host ya tiene a `~/.uxnan/host/versions/<version>-<hash>/` (carpetas `0700`,
nombre temporal unico y renombrado, porque un rename SFTP no reemplaza; dos
instalaciones simultaneas de la misma build no se pisan: gana la primera y la
segunda conserva la suya), y el propio binario prueba que corre ahi (`version`,
con su ventana de protocolo). Nada se descarga ni se compila en el host. La
carpeta se nombra por version **y contenido**, asi que otra build nunca reutiliza
en silencio lo que ya hubiera, y una actualizacion nunca reemplaza el programa
del que arranco un daemon vivo. **Las builds viejas las quita el propio host**
(`crates/uxnan-host/src/versions.rs`): cada proceso que corre de una build —el
daemon, y cada `attach` mientras dura su conexion— tiene un `flock` compartido
sobre el `.in-use` de su carpeta; un daemon que arranca borra las demas carpetas
que nadie tiene y que tienen mas de 10 minutos (una subida reciente esta a punto
de correr).

**Distribucion: empaquetados, no descargados.** Cada instalador lleva las cuatro
builds (Linux x86_64/aarch64 musl, macOS arm64/x86_64; ~1.5–1.9 MB cada una) como
recursos `host-engine/<triple>/uxnan-host`: una laptop Windows maneja un servidor
Linux, asi que la plataforma del host no es la de la app. Nada que bajar ni que
verificar dos veces, y funciona sin Internet en ninguno de los dos lados. La
release las compila en un job propio (`release-desktop.yml` → `host-engine`: Linux
con zig en Ubuntu, el par Apple en `macos-14`) con la version de la release, y cada
instalador falla si falta alguna (`scripts/build-host-engine.mjs --require`). La app
las busca en su carpeta de recursos, luego en `$UXNAN_HOST_BINARIES` y, en debug,
en `src-tauri/host-engine/` y `target/<triple>/release/`.

**Conexion.** Un canal `exec` de `uxnan-host attach`, que une su stdin/stdout al
socket del daemon (`~/.uxnan/host/run/engine.sock`, en carpeta `0700`) y lo
arranca desacoplado (`setsid`, SIGHUP ignorado) si no corre. **Un solo socket,
sea cual sea la version**: una app nueva llega al daemon que tiene las terminales
del host —de la build que sea— y se encuentran en la ventana de protocolo; el
daemon nuevo toma el relevo solo cuando el viejo se queda sin nada y sale. Un
socket por version haria que la app nueva arrancara otro daemon al lado y no
viera nunca las terminales del viejo, justo lo que una actualizacion no debe
hacer. Una llamada que el daemon no conoce (de un cliente mas nuevo) se responde
con un error y la conexion sigue: colgar dejaria sin terminales por una funcion
que ninguna usa. Versiones: 1 = terminales; 2 = vigilar carpetas; 3 = hooks de
agentes; 4 = `Attach { history }`; 5 = `StopAgent` (cerrar el agente de una
terminal y solo a el, con el mismo `agentstop` que el desktop, que como
`procscan` vive ahora en el motor); 6 = `TranscriptPreview` (la vista previa
de un turno terminado, leida en el host por el mismo lector que el desktop,
`workspace_engine::transcript`, con la misma regla: solo un `.jsonl` dentro de
la carpeta de transcripts de ese agente); 7 = herramientas de los agentes
(`AgentTools`, `Event::Mcp`/`ClientMessage::McpAnswer`, `Event::OpenUrl`). 8 = los hooks de cada agente uno a uno (`HooksStatus`, `SetHook`,
`HookConfig`: el mismo instalador corrido en el host, con el `PATH` de su shell de
login); 9 = los ficheros del proyecto (`Call::Fs(FsCall)` → `Reply::Value`, el
`workspace_engine::fs` de la app corrido alli, §5.10); 10 = su git
(`Call::Git(GitCall)`, el `workspace_engine::git` de la app, y `ErrorCode::Git`
para lo que git rechaza, §5.10b); 11 = que agente corre cada terminal
(`WatchAgents`, `Event::Agent`: capa 3 en el host, §6). Imprime
una linea `UXNAN-HOST-READY` antes de las tramas: un shell de login puede haber
impreso cualquier cosa antes. **Todas** las terminales del host van por ese canal,
asi que dejan de contar una a una contra el `MaxSessions` del host.

**Windows.** El canal del daemon es una *named pipe* por cuenta y hogar del motor,
con la lista de acceso de un solo usuario (la misma `UserOnlyDacl` que el archivo de
descubrimiento del desktop, en `control-protocol::private`), que rechaza clientes
remotos y se crea con `FIRST_PIPE_INSTANCE` (un segundo daemon encuentra el nombre
ocupado). `attach` lo arranca fuera del *job* de la sesion SSH
(`CREATE_BREAKAWAY_FROM_JOB`, desacoplado): Win32-OpenSSH termina el job de una sesion
al cerrarla. Si el job no permite salir, el daemon arranca igual y el log dice que
termina con la sesion. Un grupo de procesos nuevo nace con **Ctrl+C ignorado**, y
eso lo heredan sus hijos: el daemon lo restituye al arrancar
(`SetConsoleCtrlHandler(NULL, FALSE)`), o Ctrl+C no interrumpiria nada en una
terminal del host. Lo encontro la sonda de capa 3 en el host Windows de CI. El
candado de build es `LockFileEx`; el archivo de endpoint,
el formato de los reporters `.cmd`. Probado en CI (`windows-ssh-host`: el runner
alcanza su propio OpenSSH Server) con la suite de terminales en vivo — `cmd` como
shell, y ConPTY pidiendo la posicion del cursor (`ESC[6n`) antes de dibujar, que
xterm.js responde en la app. **Donde el motor no puede correr** (sin build: ARM de
32 bits, i686, BSD; `home` con `noexec`) la terminal es un canal sobre la sesion
(§5.7): se conserva como respaldo explicito, nunca como camino paralelo, para que un
host siempre de una shell.

**Latido.** El desktop pregunta cada 10 s y da el enlace por perdido tras 30 s
sin oir nada (cualquier trama cuenta como señal de vida). Entonces cierra el canal
y cuelga la conexion SSH de esa generacion, para que el vigilante de sesion vea
el fin y la escalera de reconexion traiga el host —y sus terminales— de vuelta,
en vez de esperar los ~2 min del keepalive SSH en un enlace medio abierto.
Cerrar o desconectar el host cierra el canal del motor de forma explicita: un
canal abierto mantiene viva la conexion debajo.

**Lo que garantiza el daemon** (`crates/uxnan-host/src/daemon.rs`):

- Una terminal es del daemon, no de la conexion. Perder al cliente es
  **desengancharse**; cerrar la terminal es una llamada explicita.
- **Orden sin huecos al reengancharse:** el lector de la PTY alimenta el modelo
  de pantalla y reparte a los espectadores bajo el mismo candado, y `attach` toma
  ese candado para cortar el snapshot y registrar al espectador; el cliente recibe
  la respuesta, el snapshot y luego todo lo que sigue, nada dos veces y nada
  perdido.
- **El historial, solo a quien empieza vacio:** con `history` (protocolo 4) el
  snapshot lleva antes las lineas por encima de la pantalla (hasta 2.000, con
  sus colores) para que caigan en el scrollback del espectador; el desktop lo
  pide al reencontrar una terminal tras reiniciar la app, no al reengancharla
  tras un corte (ya tiene el suyo). Va en trozos de 64 KiB.
- **Un espectador lento se corta**, no se acumula sin limite: cola acotada por
  conexion; el cliente vuelve y recibe un snapshot nuevo.
- Una terminal terminada sigue **adjuntable** un rato (su ultima pantalla).
- Un socket rancio se **prueba** antes de reemplazarlo: nunca se borra uno con un
  daemon vivo detras; y al salir, un daemon solo borra el socket si sigue siendo
  el suyo (mismo inodo) — uno congelado y reemplazado no le quita el socket al
  que lo reemplazo.
- Sin nada que hacer —ni clientes ni terminales vivas— sale solo a los 30 min.
- Su log registra solo ciclo de vida; jamas lo que una terminal mostro o recibio.

**Del lado del desktop** (`src-tauri/src/ssh/terminals.rs`), la misma forma que la
terminal local (§5.7): el frontend elige el id, `pty:output:{id}` y
`pty:exit:{id}`. Lo nuevo es lo que pasa **entre** conexiones: al caer, la
terminal se desengancha y la pestana lo dice en una linea tenue —no se informa un
fin que no ocurrio—; al volver el host, se reengancha y se repinta desde la
pantalla del daemon. Si el daemon cambio de epoca (el host reinicio), solo
entonces se informa el fin. Tras reiniciar la app, la pestana se reconoce por su
`sid` persistente, que el daemon guarda como etiqueta de la terminal, y se
reengancha en vez de abrir otra — y el frontend no vuelve a lanzar su comando
(`spawnPty`: una terminal encontrada de nuevo ya gasto su lanzamiento). Cerrar una
pestana con el host lejos deja el cierre pendiente y se envia al volver.

**Probado:** 11 pruebas del motor (PTY y pantalla), 4 del protocolo, 6 contra el
binario real por su socket (sobrevivir a la conexion y repintar, ultima pantalla
de un programa terminado, rechazo fuera de la ventana, salida por inactividad,
`attach` arrancando un daemon desacoplado) y, en vivo contra un host Linux real:
instalar por SFTP, abrir, perder la conexion y encontrar la terminal desde una
sesion nueva.

**Vigilar la carpeta del proyecto** (protocolo 2). `fs_set_watch` recibe el
target; para un host, el motor vigila la carpeta **alli** con el mismo vigilante
que la local (`workspace_engine::watch`: `notify`, debounce de 300 ms, `.git`
fuera de las rutas y nada fuera de la carpeta —macOS entrega del historial la
creacion de la propia carpeta y de su padre—) y el
desktop emite el mismo `fs:changed`, con `target` (la misma ruta puede existir en
las dos maquinas) y `git` cuando cambio algo bajo `.git` (un commit o un stage en
una terminal, que el arbol ignora y el panel de Cambios no). El arbol y las
pestanas recargan lo que muestran; Cambios espera a que la rafaga se calme
(800 ms) y lee el host una vez. La vigilancia se vuelve a armar cuando el host
vuelve.

**Estado preciso de agentes** (protocolo 3, fase 2). Sin tunel inverso: el
reporter de cada agente postea a un receptor del **propio motor**, en el
loopback del host, y el reporte viaja por el canal que ya existe.

- *Cableado.* `WireHooks` corre en el host el **mismo instalador** que el
  desktop (`workspace_engine::agent_hooks`): los mismos scripts en
  `~/.uxnan/hooks/` del host y el mismo registro en la config de cada agente,
  conservando lo ajeno, los permisos del fichero y el `.bak`. El alcance es
  `Reach::PresentAgents`: solo los agentes de los que el host da señales (su
  ejecutable en el `PATH` del shell de login —el del daemon es el minimo de un
  `ssh host cmd`— o su carpeta de config); nunca se crea la carpeta de otro
  producto. El desktop lo pide al conectar si `auto_install_hooks` esta activo.
- *Receptor.* `127.0.0.1:<puerto>` con token propio del daemon (24 bytes de
  `/dev/urandom`), una sola ruta (`POST /hook`), cuerpos con `Content-Length`,
  `Expect: 100-continue` atendido, topes de 16 KiB de cabeceras, 512 KiB de
  cuerpo y 5 s por peticion. Responde `204` en el acto: ningun reporter lee la
  respuesta y ninguno debe esperar a un enlace lento. Las coordenadas tambien
  quedan en `~/.uxnan/host/run/endpoint.env` (`0600`).
- *Entorno.* Cada terminal del motor arranca con `UXNAN_AGENT_ID` (lo manda el
  desktop: el id de la pestana) y, despues —para que ganen—, `UXNAN_HOOK_URL`,
  `UXNAN_HOOK_TOKEN` y `UXNAN_ENDPOINT_FILE` del daemon. El daemon borra de su
  propio entorno esas claves heredadas (`pty::PER_TERMINAL_KEYS`, la misma lista
  que `launchenv`) y ya **no** cambia su umask: las terminales la heredan, y un
  fichero creado en ellas debe salir como en cualquier sesion SSH (sus propios
  ficheros llevan modo explicito).
- *Entrega.* `Event::Hook { session, headers, body }` — las cabeceras
  `x-uxnan-*` (nunca el token) y el cuerpo tal cual — solo a las conexiones que
  miran **esa** terminal; sin nadie mirando se guardan los 64 mas recientes y se
  entregan tras la pantalla al reengancharse. El desktop los procesa **en
  orden** y los busca por sesion (`tab_for`): tras reiniciar la app la pestana
  tiene otro id y el agente conserva el viejo. Reescribe `x-uxnan-agent-id` al
  de la pestana y llama al mismo `hooks::handle_report` con
  `ReportOrigin::Host`, que no lee en esta maquina ninguna ruta que el reporte
  nombre: la vista previa de un turno terminado se le pide al motor del host
  (`TranscriptPreview`), que lee el transcript alli.

Probado contra el binario real (un reporte del script real llega solo a su
terminal, espera mientras nadie mira y llega tras la pantalla; el cableado
registra los reporters y conserva lo ajeno; la umask de las terminales) y en
vivo contra un host Linux: un reporte cruza un reinicio de la app hasta la
pestana nueva, y **el Claude Code del host** corrio un turno cuyos hooks
(`UserPromptSubmit`, `Stop`, `SessionEnd`) llegaron a esta maquina.

**Herramientas de los agentes del host** (protocolo 7). El receptor del motor
atiende ademas `POST /browser` (el shim de `$BROWSER`; responde 204 y viaja como
`Event::OpenUrl` a una conexion que mira esa terminal — sin nadie mirando, no se
abre despues) y `POST /mcp` (con `Authorization: Bearer` o `X-Uxnan-Token`; viaja
como `Event::Mcp` con un ticket, el desktop responde con `ClientMessage::McpAnswer`
lo que respondio su propio `control::mcp::handle` como `Caller::Launch` de la
pestana, y la peticion espera hasta 300 s; si esa conexion se va, se le responde
502 en vez de dejarla colgada). El MCP del desktop es JSON peticion/respuesta, sin
SSE, asi que un ticket por llamada basta. `AgentTools` da los *hechos* del host —
su endpoint, el token, el shim, el archivo de Claude que el motor escribio en
`~/.uxnan/host/run/mcp/claude-<port>.json`, la version de OpenCode instalada alli—
y el desktop construye el catalogo de lanzamiento de ese host con el **mismo**
codigo que el suyo (`workspace_engine::mcp_launch`, movido desde `mcpinject`):
`mcp_info(target)` para el frontend y las variables de la terminal en
`pty_create`, bajo los mismos ajustes que una terminal local. Un `localhost:<p>`
que el host pide abrir se trae aqui por el mismo reenvio que "Abrir" del indicador
de puertos. Probado en vivo: el Claude del host llamo a `uxnan_status` por el
motor e imprimio la pestana con la que se le respondio.

**Pendiente** (`FOR-DEV.md` → *Remote hosts*): la primera release que compile y
empaquete los binarios del host; Windows con PowerShell como `DefaultShell` y ARM64
sin probar en vivo;
pasar la sesion de un agente del host a un chat (necesita el bridge del host,
F8; el motor ya cierra el agente). Las filas del host en Ajustes → Hooks y los
ficheros, git y busqueda servidos por el motor ya estan hechos (§5.10–§5.10i).

## 5.17 La pagina del host, el doctor y el modo sin conexion — IMPLEMENTADO (F7)

**La pagina del host** se abre con *Detalles* en su fila de Ajustes → Hosts
(`HostDetailsDialog`). Tiene cuatro partes:

- **La comprobacion** (`ssh_host_doctor` → `ssh/doctor.rs`), un paso por fila:
  la ruta resuelta (directa, por bastiones, o un `ProxyCommand`, que no se sondea
  aparte), si el primer salto contesta por TCP y en cuanto, si la clave esta en
  `known_hosts`, el inicio de sesion, la shell, el motor (version, plataforma o el
  motivo por el que no corre), la ida y vuelta que mide el latido del motor
  (`round_trip`, la misma que se publica como `SshHostSession.latencyMs`) y el
  reenvio del agente. **Nunca inicia sesion para averiguarlo**: lee lo que la app
  sabe y sondea el primer salto, asi que no cuesta nada ni pide nada. Lo que solo
  una sesion puede contestar dice *Conecta para comprobarlo* hasta que la hay.
- **La maquina**: el inventario completo (§5.6), con la version de cada agente.
- **Las terminales del host** (`ssh_host_sessions`): todas las que tiene el
  motor, tambien las que ninguna pestana de esta ventana muestra —las deja una
  ejecucion anterior de la app—, con si estan abiertas aqui. *Terminar* una
  (`ssh_host_session_end`) va cercado a la conexion que el usuario ve y pide
  confirmacion.
- *Olvidar host*, y *Conectar* / *Desconectar*.

**El estado del host, en un solo sitio** (`hosts.stateOf` → conectado,
conectando, esperandote, sin conexion; `HOST_STATE_TONE` le da el color). Lo
usan la fila de Ajustes, la pagina, la ficha del proyecto en la barra lateral
(un punto, y la latencia en el tooltip) y la pestana de una terminal del host
(una insignia con el nombre del host y su punto; el titulo se atenua mientras el
host no esta). Nadie decide el estado por su cuenta.

**Modo sin conexion.** Cuando un host se va, el arbol de ficheros que ya habia
leido algo lo **conserva**, marcado sin conexion y con cuando se leyo
(`OfflineNote`: "build-box esta sin conexion — esto se leyo hace 3 minutos"); no
es `mutable` mientras tanto y se vuelve a leer cuando el host vuelve. Cambios e
Historial hacen lo mismo con la misma nota. Un arbol que nunca recibio su primera
respuesta sigue diciendo que espera. Es la regla de §6: lo que se muestra de otra
maquina nunca se presenta como actual.

**La limpieza de worktrees en un host** tiene su selector de maquina en Ajustes →
Git → Limpieza (`MachinePicker`, el mismo que Ajustes → Hooks); escanear, medir y
quitar van al motor de ese host (§5.10i), y quitar va cercado.

**Lo que queda fuera:** el coste por comando de §5.3 no se mide —con el motor, el
trabajo repetido ya no paga un `exec` por llamada, y en un host sin motor la
medida costaria justo ese `exec`—; queda anotado en `FOR-DEV.md`. Agrupar los
proyectos por host en la barra lateral queda para un posible rediseño del panel
izquierdo, a decidir por el mantenedor.

## 5.18 El bridge del host — ENLAZADO (F8, primera parte)

**Un dueño por capacidad.** Las conversaciones, el trabajo headless y el
telefono son del bridge; en un host, del **bridge del host**: el mismo
`uxnan-bridge`, instalado en esa cuenta. El desktop le habla igual que al suyo,
por el canal de control local (`02a` §5.8.15), y no hay un segundo runner en el
motor.

**Como se llega, sin abrir ningun puerto** (`ssh/bridge.rs`):

- **El registro lo lee el motor del host**: `~/.uxnan/local-control.json` de esa
  cuenta, con el puerto y el token. Es el unico sitio donde existe el token, y no
  toca el disco de esta maquina: vive en memoria lo que dura el enlace.
- **El socket es un canal SSH `direct-tcpip` al `127.0.0.1` del host.** `sshd`
  lo abre desde el loopback de esa maquina, que es el par que el bridge exige, asi
  que su autorizacion no cambia —loopback, sin `Origin`, el token—. El cliente
  WebSocket es el mismo (`Connection::open_over`); el local hace lo mismo sobre
  TCP.

**Un enlace por host, que vive lo que su motor** (`bridgeclient/hosts.rs`).
Empieza cuando arranca el motor de una conexion y termina cuando ese motor se
pierde; una reconexion trae motor nuevo y enlace nuevo, que reanuda el registro
del bridge donde se quedo. No hay modos: si el host tiene bridge, el desktop se
enlaza; si no, lo dice (`notRunning`) y vuelve a mirar cada 30 s —una lectura de
fichero por el canal del motor, que no le cuesta nada al host— o al momento con
`bridge_host_retry`. Un enlace de un motor viejo nunca pisa el estado del nuevo
(por generacion). `bridge_call` recibe el `target`: `ssh:<hostId>` va al bridge de
ese host. Eventos: `bridge:host-status` y `bridge:host-notification`, con su
`hostId`. **Nada de esto instala ni arranca un bridge.**

**Probado en vivo** contra un bridge de usar y tirar en un host Linux real
(`a_hosts_own_bridge_answers_through_the_engine`: instalado en una carpeta propia
de la prueba, con ella como `HOME` y el LAN apagado, y borrado al final):
`bridge/status` contesto por el canal directo y por el enlace de la app.

**El chat de un proyecto del host** (desktop): una tienda y una replica por
maquina (`bridges.for`, `chatFor`), el panel de un chat provee la de su maquina
(`provideChat`), y un proyecto del host ofrece chat **mientras su bridge esta
conectado** (`bridges.offersChat`); si se cae, la pestana lo dice
(`ChatHostGate`).

**Instalarlo y mantenerlo vivo es del motor del host** (protocolo 15,
`Call::Bridge`: `Status`, `Install`, `Supervise { on }`; `uxnan-host` →
`bridge.rs`; comandos `host_bridge_status|install|supervise`, estos dos cercados):

- **Encontrarlo.** Un bridge que el usuario instalo el mismo —en el `PATH` de su
  shell de login (`own`)— es el que se usa: fue su eleccion. Si no, el de
  `~/.uxnan/bridge` (`managed`). Uno que ya corre (su propio servicio, una
  terminal) se respeta: el motor nunca arranca un segundo.
- **Instalarlo** en la cuenta: `npm install --global --prefix ~/.uxnan/bridge
  uxnan-bridge@latest` con el npm de su Node —sin administrador, nada fuera de la
  cuenta—. Esa disposicion la reconoce `bridge/update`, que usa el npm junto al
  Node que lo corre, asi que despues se actualiza solo (`canApply: true`, medido).
  Si la cuenta aun no tiene `~/.uxnan/daemon-config.json`, se escribe con
  `lanEnabled: false` y `mdnsEnabled: false`: **ningun puerto abierto por
  defecto**; uno que ya existe es del usuario y no se toca. Con el LAN apagado el
  endpoint HTTP del bridge sigue en `127.0.0.1` (bridge `[Unreleased]`), asi que
  las aprobaciones de Claude Code funcionan sin publicar nada; un bridge anterior
  a ese cambio pierde solo esas aprobaciones.
- **Mantenerlo vivo** (decision del maintainer: el motor, no un servicio del SO).
  El motor ya sobrevive a la sesion SSH, asi que arranca `node cli.js start
  --service` —sin `INVOCATION_ID`, para que su actualizacion no se crea una unidad
  de systemd— y lo vuelve a arrancar si termina, con espera creciente (2 s a 60 s)
  mientras termine rapido; tambien tras su propia actualizacion, que instala la
  version nueva y sale. Sin linger, sin administrador, igual en Linux, macOS y
  Windows. El deseo vive en `~/.uxnan/host/bridge.json` y lo retoma el siguiente
  daemon; mientras se vigila el bridge el daemon no se apaga por inactividad. Su
  salida va a `~/.uxnan/host/bridge.log`.

**Probado:** contra el daemon real con un bridge simulado (arranca, se reinicia al
morir, se suelta al pedirlo) y en vivo en un host Linux real, armado por
`UXNAN_SSH_TEST_BRIDGE=1` (`a_hosts_bridge_is_installed_and_kept_running_by_its_engine`):
instalado, vigilado, alcanzado por el enlace con `lanEnabled: false`, y detenido.

**El traspaso terminal → chat en un host** sigue la misma regla: un
`TerminalSessions` por maquina (`terminalSessionsFor`). Las terminales de un host
avisan al bridge de ese host de la sesion que tienen (`agent/hold`), responden
alli sus peticiones de traspaso, "Continuar como chat" abre el chat en ese bridge
y "Abrir en terminal" lanza la CLI del propio host. Cubierto por pruebas; el
recorrido en vivo con un agente real en un host queda pendiente.

**Pendiente** (`FOR-DEV.md` → *What an agent on a host still lacks*, punto 4):
la interfaz de todo esto en la pagina del host; instalar el bridge en el host desde
el desktop (prefijo npm en esa cuenta, npm al lado para que `bridge/update` se
actualice solo, y como sigue corriendo sin sesion abierta); las herramientas de
esta app para los agentes de ese bridge (`desktop/attach` con el `/mcp` del
motor); emparejar el telefono con el y como lo alcanza; y el trabajo headless en
el host.

## 6. Que funciona y que no en un contexto remoto

| Capa de estado de agente (`02d`) | Remoto |
|---|---|
| Capa 2 — titulo / OSC | **Funciona sin trabajo extra**: viaja en el stream de bytes del PTY |
| Capa 1 — hooks HTTP | **Funciona con el motor** (Linux, macOS, Windows): los reporters, cableados alli, postean al receptor del motor y el reporte viaja por su canal (§5.16). Sin el motor: no |
| Capa 3 — deteccion de proceso | **Funciona con el motor**: el motor lee la tabla de procesos del host cada 2 s —solo mientras alguien mira y la app le dijo que agentes buscar (`WatchAgents`)— con el mismo `procscan` que la app usa aqui, y avisa cuando cambia el agente de una terminal (`Event::Agent`), tambien a quien vuelve a conectarse. La pestaña lo recibe como el mismo `agent:detected` local (§5.16) |

| Panel sobre un proyecto remoto | Hoy |
|---|---|
| Terminal | **Funciona**: en Linux, macOS y Windows vive en el motor del host y sobrevive a cortes y reinicios de la app (§5.16); en un host donde el motor no puede correr (sin build, `home` con `noexec`), canal sobre la sesion (§5.7) |
| Ficheros | **Funciona** por el motor (§5.10): listar con ignorados marcados, abrir, **guardar** (atomico, conservando el modo, con fencing) y **previsualizar** imagenes y PDF. Sin motor: no hay ficheros de proyecto, y se dice |
| Rama y estado git de la fila | **Funciona** por el motor (§5.10b): rama, cambios y distancia con el upstream, leidos en el host |
| Diff de imagenes / borrador con IA | **Funciona**: los bytes de la imagen viajan como bytes (§5.10h) y el agente corre en esta maquina sobre el diff leido alli. |
| Buscar (nombre y contenido) | **Funciona** por el motor, con el mismo recorrido que aqui (§5.10e), sea o no un repositorio. |
| Crear / renombrar / duplicar / borrar en el arbol | **Funciona** por el motor y cercado (§5.10d). Borrar es **permanente**: no hay papelera en un host, y el dialogo lo dice. |
| Cambios / Historial | **Funciona** por el motor: diff por fichero y por hunk, staging, descarte, commit, log y fetch/push/pull (con el agente que reenvia la conexion), ejecutados en el host. Se refresca con el vigilante del motor. §5.10c |
| GitHub | **No disponible**: lee el repositorio de esta maquina y su sesion de `gh`. El panel lo dice y ofrece la terminal. §5.11 |
| Puertos | **Funciona** (§5.14): lo que una terminal anuncia aparece solo; el boton pregunta al host; "Abrir" trae el puerto a `127.0.0.1` y lo previsualiza. Nada se reenvia sin pedirlo |
| Refresco automatico de cualquiera de los anteriores | **Si con el motor** (Linux, macOS, Windows): el motor vigila la carpeta **alli** y empuja los cambios —tambien los de `.git`— como el mismo `fs:changed`, con su target (§5.16). Sin el motor: al abrir, al actuar y con el boton; sondear cuesta ~2 s por `exec` (§5.3) |

Regla de honestidad para la interfaz: lo que no se puede medir en remoto se
marca **"no disponible en este entorno"**. Jamas se rellena con el dato local.

## 7. Fases

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Identidad de destino y fencing (`02a` §2.9) | **Hecho** |
| 1 | Registro de hosts, conexion, inventario, PTY remota, lanzador | **Hecha** — hecho: configuracion SSH resuelta en cada conexion (§4), la ruta por bastiones y `ProxyCommand` (§4.1), registro y edicion, conexion y claves (con rotacion guiada, §5.1), autenticacion completa con segundo factor (§5.2), inventario, terminal remota, explorar carpetas, añadir un proyecto del host y seleccionarlo (§5.9), y el lanzador filtrado por el inventario del host. Sus deudas estan saldadas: presupuesto de canales (§5.10g), escalera de reconexion (§5.12) y el inventario en la interfaz (§5.13). Ya no: reconectar al arrancar los hosts que no piden nada, que se hace desde `ssh_hosts_resumable` |
| 2 | Estado preciso (reporters remotos) | **Hecha con el motor** (Linux, macOS): sin tunel inverso, por el canal del motor (§5.16). Faltan pasar su sesion a un chat (bridge del host) y Windows |
| 3 | Archivos, git y worktrees remotos | **Hecha**, servida por el motor del host desde F4 del plan 037: ficheros (§5.10, leer, **guardar** y **previsualizar**), worktrees (§5.10i: listar, crear, quitar), explorador por SFTP (§5.8), rama/estado de git (§5.10b), Cambios/Historial (§5.10c), las operaciones de fichero del arbol (§5.10d), la busqueda (§5.10e), el aviso de sesion caida (§5.10f), el presupuesto de canales (§5.10g) y las dos ultimas piezas del panel (§5.10h). Solo GitHub sigue siendo local, por lo que lee. El ayudante en el host queda **descartado**, con sus razones en §5.11 |
| 4 | Puertos detectados, forward y vista previa en el navegador integrado | **Hecha** — deteccion por lo que anuncia la terminal (`portscan.rs`) y por pregunta al host (`ssh/ports.rs`), tunel `direct-tcpip` en loopback (`ssh/forward.rs`) y vista previa por `openUrl` desde el popover de la barra de estado (§5.14) |
| 5 | Continuidad y recursos remotos | **En curso** — terminales que sobreviven a la conexion y al reinicio de la app, hechas en el motor del host (§5.16); sus binarios van en cada instalador (Linux, macOS y Windows); faltan los recursos remotos |
| 6 | Que el movil vea tambien los destinos (solo contrato aditivo) | Pendiente |

## 8. Fuera de alcance (con motivo)

- **Contenedores y devcontainers.** Un entorno declarado por el usuario que
  imprima un destino SSH entra por la misma puerta que un host; no hace falta
  arquitectura nueva para ello.
- **Sandboxes.** Cada CLI de agente trae el suyo o ninguno (y en Windows nativo
  casi ninguno aplica), asi que el ADE no puede prometer un aislamiento
  uniforme sin mentir. Lo que si puede es exponer y explicar el de cada agente.

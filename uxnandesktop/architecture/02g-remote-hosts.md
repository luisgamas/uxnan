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
| §5.0 | handshake, veredicto de clave, generacion de conexion | implementado |
| §5.1 | la decision sobre `known_hosts` | implementado |
| §5.2 | autenticacion (agente, llave, contrasena) | implementado |
| §5.3 | comandos como canales, su coste medido, el candado y que shell se usa | implementado |
| §5.4 | registro de hosts y lapidas | implementado |
| §5.5 | sesiones vivas y su superficie de comandos | implementado |
| §5.6 | inventario del host | implementado |
| §5.7 | terminal remota, keepalive y caidas | implementado |
| §5.8 | explorar carpetas, por SFTP | implementado |
| §5.9 | un proyecto que vive en el host | implementado |
| §5.10 | ficheros del host: listar, abrir y guardar | implementado |
| §5.10b | rama y estado de git en el host | implementado |
| §5.10c | Cambios e Historial del host | `ssh/git.rs`, `gitRouter.ts` |
| §5.10d | Crear/renombrar/duplicar/borrar en el host | `ssh/sftp.rs`, `fsRouter.ts` |
| §5.10e | Buscar en el proyecto del host | `ssh/search.rs`, `fsRouter.ts` |
| §5.10f | Avisar de una sesion caida | `commands.rs`, `hosts.svelte.ts` |
| §5.10g | Presupuesto de canales | `ssh/conn.rs` |
| §5.10h | Diff de imagenes y borrador con IA | `ssh/conn.rs`, `aicommit.rs` |
| §5.12 | Escalera de reconexion | `ssh/conn.rs`, `commands.rs` |
| §5.13 | El inventario en la interfaz | `HostsSettings.svelte` |
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

Cableado: el callback del cliente la consulta en cada handshake, y la confirmacion
TOFU vive en Ajustes -> Hosts.

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

**El intercambio abre con un intento `none`.** No es un atajo esperando un
servidor abierto: es como SSH pregunta *"¿que aceptas?"*. Esa respuesta es lo que
evita ofrecer llaves a un host que solo toma contraseña y, sobre todo, lo que
evita decir "fallo la autenticacion" cuando la respuesta real es "esta maquina
quiere una contraseña y a nadie se le ha pedido una".

Resultados tipados, no un booleano:

| Resultado | Significa | Que hace la UI |
|---|---|---|
| `Success { method }` | autenticado, y **con que** credencial | puede decir por donde entro |
| `NeedsPassphrase { path }` | la llave esta cifrada y no habia passphrase (o era incorrecta) | la pide y reintenta **esa** credencial |
| `NeedsPassword { attempted }` | el host acepta contraseña y no teniamos ninguna; `attempted` lleva lo ya rechazado | pide contraseña, diciendo tambien que llave fue rechazada |
| `Failed { attempted }` | todo lo ofrecido fue rechazado, con la lista en orden | mensaje concreto, no "fallo la autenticacion" |
| `NoUsableMethod` | el host no acepta nada que podamos ofrecer | lo dice tal cual, no como rechazo |

**La contraseña es el camino que hace posible una primera conexion sin preparar
nada en la maquina remota** — sin generar llave, sin tocar `authorized_keys` —, y
para la mayoria de la gente esa es la diferencia entre "conecte" y "lo deje".
`NeedsPassword` lleva lo ya intentado para poder decir las dos cosas a la vez:
que llave se rechazo y que se puede probar contraseña.

Se prueban `password` y `keyboard-interactive`, porque los servidores discrepan
sobre a cual pertenece una contraseña simple (con PAM de por medio suele ser solo
la segunda). El lado interactivo responde **solo a peticiones de un unico
prompt**: un servidor que pregunta dos cosas esta pidiendo un segundo factor, y
repetir ahi la contraseña seria erroneo ademas de quemar un intento de OTP; eso
necesita una UI prompt-a-prompt y queda diferido en vez de fingido.

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
`SSH_AUTH_SOCK`. **Validado de punta a punta** contra un `sshd` real: se habla
con el named pipe, se ofrece una identidad que el agente sostiene, el servidor la
acepta y despues un comando corre en esa sesion autenticada. Tambien validado el
lado negativo: una llave no autorizada vuelve como rechazo limpio nombrando lo
que se ofrecio, y una contrasena incorrecta como rechazo, no como error de
transporte.

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

- El **doctor** mide este coste por host y lo dice, porque explica por que ese
  host se siente lento y tiene arreglo del lado del usuario (poner `cmd` como
  `DefaultShell` del `sshd`, o meter una guarda rapida en su perfil).
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

Pendiente y anotado: **avisar a la interfaz** cuando una sesion se cae. Hoy se
entera al preguntar; el keepalive (§5.7) lo detecta en ~2 min, pero nadie emite
un evento.

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

Queda un hueco, anotado en `FOR-DEV.md` en vez de disimulado: cuando la conexion
se cae, el frontend no recibe **evento**; se entera al preguntar.

Validado en vivo contra un `sshd` real: abrir, escribir un comando, leer su eco,
redimensionar y cerrar; crear dos veces el mismo id no abre dos terminales; y
desconectar el host hace que la terminal reporte salida.

## 5.8 Explorar carpetas del host — IMPLEMENTADO

`src-tauri/src/ssh/browse.rs`. **Por SFTP, igual que el arbol de ficheros — no
preguntandole a un shell.** Antes se mandaba un script y se parseaba la
respuesta: POSIX primero y PowerShell de reserva, o sea que un host con
PowerShell pagaba **dos** comandos remotos por cada clic, y cada uno arranca una
shell con su perfil en la otra maquina.

Medido, que es lo que decidio el cambio:

| | |
|---|---|
| Listar una carpeta **por shell** | 336 ms (contra el `sshd` de esta maquina, con `cmd`) |
| La misma carpeta **por SFTP** | **6,6 ms** |
| Un `exec` en el host real del usuario (§5.3) | **2.109 ms** — y eran dos por clic |
| Insignia de repo: 63 carpetas, una a una | 44 ms |
| Las mismas 63 **a la vez** | **3,3 ms** |

Esa ultima fila es la que hace viable la insignia: las peticiones SFTP
**se encauzan en el unico canal**, asi que el listado cuesta un viaje de ida y
vuelta, no uno por carpeta. Y no consume canales extra (§5.3, `MaxSessions`),
porque van todas por la sesion que ya esta abierta.

**Detalle que solo aparecio corriendolo:** un host Windows contesta
`realpath(".")` con `/C:/Users/gamas`. Correcto dentro del protocolo —ahi todo
cuelga de `/`— e inutilizable fuera: esa cadena se guarda como ruta del proyecto,
se teclea en una terminal de esa maquina y se le pasa a su git, y ninguno la
acepta. Se le quita la barra (`strip_sftp_drive_root`), con sus tests.

**Lo que se pierde:** un host con el subsistema `sftp` deshabilitado ya no se
puede explorar. Es una configuracion rara y el arbol de ficheros ya dependia de
SFTP, asi que ese host tampoco servia para gran cosa; se dice claro en vez de
mantener dos implementaciones del mismo listado.

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

Ficheros y rama **ya no estan en esa lista**: van por SFTP (§5.10) y por git en el
host (§5.10b). `worktree_list` sigue devolviendo **un** espacio para un proyecto
remoto —no hay worktrees remotos todavia— pero su rama ahora se lee alli, y
cuando el host no puede contestar la fila dice "rama sin leer" en vez de
`(detached)`: eso ultimo seria afirmar algo sobre un repositorio que nadie
abrio.

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

## 5.10 Ficheros del host — IMPLEMENTADO (fase 3, primera parte)

`src-tauri/src/ssh/sftp.rs`. **Los ficheros van por SFTP, no por comandos.** Es la
consecuencia directa de la leccion de §5.7: cualquier cosa con forma de comando
depende de la shell que ese `sshd` arranque, y su dueño la cambia cuando quiere.
SFTP es un **subsistema** —un programa que el servidor ejecuta, con protocolo
binario— asi que listar un directorio o leer un fichero se comporta igual con
cmd, PowerShell, WSL o Git Bash, y **no hace falta instalar nada en el host**.
Nada que entrecomillar, nada que parsear, ninguna shell a la que culpar.

**Misma forma que en local.** Devuelve los tipos del layer local (`FsEntry`,
`FileContent`), de modo que el arbol de ficheros y el editor dibujan los ficheros
de un host con los componentes que ya existen — el mismo criterio que el selector
de carpetas. Una sesion SFTP por host, abierta al primer uso: es un canal sobre la
conexion que ya esta autenticada (§5.3), asi que mantenerla no cuesta nada y
reabrirla por listado costaria un viaje por carpeta.

**Un solo sitio decide a que maquina se lee** (`src/lib/fsRouter.ts`): ruta +
maquina, y el enrutado sale de ahi. La alternativa —que cada punto de uso
pregunte "¿esto es remoto?"— es exactamente la forma que ya nos costo un fallo.

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

`RemoteFiles::read_data_url` + `ssh_fs_read_data_url`. Reportado desde la app:
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

Del lado del host se hace lo minimo y por SFTP, sin instalar nada: se **pregunta
el tamaño antes de leer** —el tope de 25 MiB existe para no meter un blob enorme
en el webview, y aqui ademas evita arrastrarlo por el enlace—, se leen los bytes
tal cual (la misma exigencia que el diff de imagenes, §5.10h) y el tipo se decide
con el mismo olfateador que en local, de modo que un fichero se previsualiza —o
se rechaza— igual en las dos maquinas. Verificado en vivo contra un `sshd` real:
el PNG vuelve byte a byte identico al del disco y un `Cargo.toml` se rechaza
diciendo que no es imagen ni PDF.

### Guardar: en el sitio, porque el reemplazo atomico no existe aqui

`RemoteFiles::write_file`. En local se escribe a un temporal y se renombra
encima — atomico. **Sobre SFTP eso no se puede**, y no es opinion: medido contra
un `sshd` real, en este orden.

| Medicion | Resultado |
|---|---|
| `SSH_FXP_RENAME` sobre una ruta **que ya existe** | **Falla** (`Status: Failure`) |
| `write()` de la libreria (abre solo con `WRITE`) | Escribir `SHORT` sobre un fichero mas largo dejo `SHORTCONTENT-0123456789` |
| `WRITE \| CREATE \| TRUNCATE` | Correcto, incluido acortar y vaciar |
| `fsync@openssh.com` | Soportado por este servidor |

El rename que **sobrescribe** es la extension `posix-rename@openssh.com`, que la
libreria cliente no implementa (y que en OpenSSH para Windows fue durante años
un `unlink`+`rename`, o sea tampoco atomico). Asi que "temporal y renombra"
fallaria en **todos** los guardados salvo el primero.

Y el plan B —borrar el destino y luego renombrar— cambia un fichero truncado por
uno **inexistente**, que es el fallo peor: tras una escritura mala el editor
sigue teniendo el texto, tras un borrado malo no lo tiene nadie. Un temporal
ademas **pierde permisos y dueño** del destino, porque lo que sobrevive es el
temporal.

Por eso se escribe **en el sitio**: `WRITE | CREATE | TRUNCATE`, escribir, pedir
`fsync` (best effort: un host sin la extension no es motivo para fallar un
guardado que ya acepto), cerrar, y **preguntar el tamaño al host**. Ese ultimo
paso es el unico que detecta un guardado que almaceno menos bytes de los que se
enviaron — el editor no puede notarlo solo, y seguiria mostrando texto que el
host no tiene. Conserva el fichero tal cual: modo, dueño, enlaces duros y a
donde apunta un symlink.

**Fenced** (`02a` §2.9): `ssh_fs_write` verifica maquina y generacion **antes**
de abrir, porque abrir ya trunca. La generacion viaja al frontend en
`ssh_hosts_connected` —no solo en el informe de conexion— porque la ventana se
recarga mucho mas a menudo de lo que se conecta un host, y sin eso cada guardado
posterior a una recarga llevaria una expectativa que no emitio nadie.

**Lo que no hace, y se dice:**

| | Estado |
|---|---|
| Listar y abrir ficheros | **Funciona** |
| Previsualizar una imagen o un PDF | **Funciona** (arriba): se lee por SFTP de la maquina del fichero, con el mismo tope y el mismo criterio de tipo que en local |
| Marcar ignorados por git (`ignored`) | **No**: solo git puede responderlo, y git remoto es su propia pieza. Un arbol que no atenua nada es honesto; uno que adivina esta mal en silencio |
| Buscar en el arbol | **No ofrecido**: la busqueda recorre *este* filesystem, asi que contestaria "sin resultados" a todo. Se oculta la accion en vez de ofrecerla rota |
| Refresco automatico | **No**: el watcher es local. El boton de refrescar es la recarga |
| Guardar un fichero | **Funciona** — en el sitio y con fencing (arriba) |
| Renombrar / borrar / crear desde el arbol | **Pendiente**: el menu contextual sigue siendo local |

Validado en vivo contra un `sshd` real: 14 entradas de un directorio de codigo,
rutas absolutas y con barras hacia delante, directorios primero, y 7.924 bytes
leidos de un `Cargo.toml` que es el fichero de verdad. Y la recuperacion, tambien
en vivo: una sesion muerta en la cache se sustituye y el listado sale igual, una
que muere sin que nadie lo note se reintenta, y un "no existe" se reporta a la
primera sin tocar la sesion que iba bien.

## 5.10b Git del host — IMPLEMENTADO (fase 3, segunda parte)

`src-tauri/src/ssh/git.rs`. A diferencia de los ficheros, git hay que
**ejecutarlo**, asi que pasa por `exec` y por tanto por la shell de esa maquina —
el unico punto de la fase 3 donde la shell interviene. La diferencia con los
intentos anteriores es que no se supone: §5.7 la pregunto, y **cada argumento se
entrecomilla para esa respuesta** (`quote_arg`). Una shell que no se pudo nombrar
no recibe nada: la fila dice que la rama no se leyo, que es verdad.

**Un comando, salida entre marcadores** (§5.3): rama, distancia con el upstream y
recuento de cambios se piden juntos. `git -C <ruta>` en vez de un `cd`, porque no
necesita sintaxis de shell mas alla del entrecomillado.

**Dos cosas que el test en vivo enseño y los unitarios no podian:**

1. **Encadenar con `&&` era un error.** Una rama sin upstream hace fallar
   `rev-list`, y con `&&` eso se comia todo lo que venia detras —el marcador de
   fin incluido—, asi que un checkout real volvia como "no es un repositorio". Se
   secuencia sin condicion: `&` en cmd, `;` en POSIX y PowerShell.
2. **La linea de distancia puede no existir.** Solo un par "<n> <n>" limpio se
   toma como distancia; cualquier otra cosa sigue siendo un cambio.

**`isRepo: false` es el cajon honesto**: no es repositorio, no hay git instalado,
o la shell no se pudo nombrar. La UI **no** lo pinta como "sin cambios" — deja los
badges como estaban, porque cero cambios y "no se pudo leer" no son lo mismo.

Validado en vivo contra un `sshd` real sobre un checkout de verdad: rama
`feat/desktop-remote-ssh-hosts`, 9 ficheros sucios, y una carpeta que no es
repositorio contestando `isRepo: false`.

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
falta. Al reconectar los hosts solos al arrancar (§5.4b) el mensaje dejo de
aparecer y el hueco quedo a la vista. Leccion anotada: **cuando un cambio quita
un estado de la interfaz, hay que buscar que otra cosa dependia de que ese estado
ocurriera.**

**"El host no esta conectado" es un estado, no un fallo.** Al abrir la app antes
de conectar, el arbol se quedaba con el error hasta cambiar de proyecto y volver:
nada reintentaba, porque la raiz fallida nunca entraba en el conjunto cargado.
Ahora el backend lo distingue (`AppError::NotConnected`, codigo `NOT_CONNECTED`),
el panel dice que espera, y al conectar el host el arbol se rellena solo
(`fileTree.retryForHost`).

## 5.10c Cambios e Historial del host — IMPLEMENTADO (fase 3, tercera parte)

`src-tauri/src/ssh/git.rs` (lectura y mutaciones), `src/lib/gitRouter.ts` (a que
maquina va cada operacion) y los dos stores del panel derecho. Con esto las
pestañas *Cambios* e *Historial* describen la maquina en la que el proyecto vive
de verdad, en lugar del aviso que las sustituia. GitHub conserva el aviso, porque
si lee el repositorio de **esta** maquina y su sesion de `gh`.

**Una peticion, no cuatro.** El layer local pide estado, distancia y numstat por
separado porque cada llamada cuesta microsegundos. En un host cada una es un
arranque de shell (~2 s, §5.3) y el panel las quiere todas a la vez, asi que
`review()` manda **un** comando con cuatro secciones separadas por marcadores
(`rev-parse HEAD`, `rev-list --left-right --count`, `status --porcelain=v1 -z` y
`diff --numstat HEAD`) y lo parsean **los parsers locales** — `parse_status_files`
y `parse_numstat`. Dos parsers para un mismo formato serian dos oportunidades de
discrepar sobre un mensaje de commit con un salto de linea dentro.

Las secciones van marcadas y no contadas: dos pueden venir vacias y una
(`--porcelain -z`) no contiene saltos de linea, asi que partir por lineas las
fundiria — y un repositorio limpio volveria como uno que no se pudo leer.

**El unico bug real de esta parte lo encontro el host Linux** (§5.12), no los
unitarios: el estado de un cambio sin preparar es un **espacio** a la izquierda
(` M README.md`), y recortar la seccion como espacio en blanco se lo comia, con
lo que cada ruta llegaba un caracter mas corta y el panel listaba `EADME.md`
—preparar ese fichero habria fallado sobre algo que no existe—. Ahora se recortan
solo saltos de linea, con un test unitario que ya no necesita Docker.

**Lo que cambia el host va por SFTP, no por su shell.** `git apply` y
`git commit` leen su entrada de **stdin**, y `Connection::exec` no tiene stdin.
El parche y el mensaje se escriben con la sesion SFTP que ya esta abierta y se
apunta git al fichero (`-F`, `apply <fichero>`): un mensaje multilinea con
comillas y `$VAR` llega exactamente como se escribio, sin pasar por las reglas de
entrecomillado de tres dialectos. El temporal vive junto al `.git` del propio
repositorio —el unico directorio en el que el usuario seguro puede escribir en esa
maquina, y en el mismo sistema de ficheros— y **se borra pase lo que pase**: un
commit fallido dejaria si no un mensaje que el siguiente leeria como suyo.

**Toda mutacion va cercada.** Preparar, descartar, aplicar un hunk o commitear
llevan la `TargetExpectation` (§2.9 de `02a`) y el backend la comprueba **antes**
de enviar nada — un descarte no se puede deshacer una vez que el host lo ha
ejecutado, y la misma ruta absoluta suele existir en las dos maquinas, asi que
una mutacion mal encaminada es justo la que se parece a un exito. El frontend se
niega antes incluso de llamar cuando no puede nombrar una conexion: mandar un cero
seria una expectativa que nadie emitio.

**`fetch`, `push` y `pull` corren alli**, con las credenciales de esa maquina —el
proyecto vive en ella, luego su remoto es alcanzable desde ella y no
necesariamente desde aqui—. Un canal `exec` no tiene terminal, asi que un remoto
que pida contraseña falla en vez de esperar a que alguien la escriba: la salida
honesta, que ademas indica donde hay que configurar las credenciales.

**Enrutado en un solo sitio.** `gitRouter.ts` es el hermano de `fsRouter.ts` y
existe por lo mismo: la alternativa es que cada punto de llamada pregunte "¿esto
es remoto?", que es la forma que ya nos costo un error. El store del panel guarda
la maquina **al lado** de la ruta, porque ninguna de las dos significa nada sola.

**Dos cosas siguen siendo de esta maquina**, y ahora estan ausentes en vez de
rotas: el **borrador de commit con IA** (lee el diff preparado con el git local) y
el **diff de imagenes** (lee los blobs igual). Ambas necesitan traer el contenido
aqui primero; quedan anotadas en `FOR-DEV.md`.

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

**Sin watcher, y dicho.** El sondeo de 3 s es el git de esta maquina; hacerlo
contra un host seria un arranque de shell cada tres segundos en el ordenador de
otro, por worktree. En remoto el boton de refrescar **es** la actualizacion y su
tooltip lo dice — no un cartel explicando el funcionamiento de la app. Ademas el
evento del watcher local se ignora cuando el panel mira a un host: la misma ruta
absoluta existe en las dos maquinas, y sin esa comprobacion la lista de ficheros
de aqui pisaria la revision de alli.

**Al conectar y al desconectar, los paneles reaccionan solos.** No empujando
desde el store de hosts —eso importaria `git`, que importa `app`, que importa
`hosts`: el ciclo que el registro hoja de sesiones existe para evitar— sino
leyendo ese registro desde los efectos de los propios paneles. Un host que aun no
esta arriba se dice **en silencio** ("esperando a que el host se conecte"), como
ya hacia el arbol: un toast rojo en cada arranque en frio, por un estado que la
app resuelve sola, es ruido sobre el que el usuario no puede actuar. Y cuando el
host se va, la lista se vacia y las acciones se deshabilitan, pero el mensaje de
commit a medio escribir se respeta.

## 5.10d Operaciones de fichero en el host — IMPLEMENTADO (fase 3, cuarta parte)

`src-tauri/src/ssh/sftp.rs` + `src/lib/fsRouter.ts`. Crear, renombrar, duplicar y
borrar, en la maquina de la que es el arbol. Todo por SFTP: no hay ni una linea
de shell aqui, asi que se comporta igual en cualquier host y no exige instalar
nada.

**Esto tapa un agujero, no solo añade una funcion.** Esos elementos del menu
nunca estuvieron condicionados, asi que sobre un arbol remoto llamaban al
filesystem **local** con la ruta de la otra maquina. Casi siempre fallaba — pero
la ruta de un host Windows (`C:/Users/…`) puede existir tambien aqui, y entonces
un renombrado o un borrado caian sobre el fichero equivocado en el ordenador
equivocado. Misma clase que el guardado mal encaminado que ya cercamos (§5.10).

**Los nombres los valida el validador local**, no un segundo escrito aqui
(`crate::fs::split_new_entry_path`, `validate_bare_name`): que una ruta no pueda
escapar de su carpeta importa exactamente igual en la maquina de otro, y dos
validadores son dos oportunidades de discrepar sobre `..`.

**"No debe existir" lo decide el servidor.** `OpenFlags::EXCLUDE` es el
`SSH_FXF_EXCL` del protocolo: la comprobacion es atomica y del host. Mirar
primero y crear despues seria una carrera que perderiamos contra el agente que
esta trabajando en esa carpeta — que es justo la razon por la que alguien tiene
ese arbol abierto.

**Renombrar no puede pisar** (SFTP v3; la misma limitacion que hizo que guardar
escriba en el sitio, §5.10), lo cual coincide con lo que el layer local quiere.
El unico caso que cuesta es cambiar solo mayusculas/minusculas en un host cuyo
filesystem las ignora, donde origen y destino **son el mismo fichero**: eso se
hace en dos pasos, por un nombre que nada usa, y solo despues de que el intento
directo haya fallado.

**Borrar es permanente, y la interfaz lo dice.** El arbol local manda a la
papelera del sistema (recuperable); SSH no ofrece nada asi, e inventar una
papelera oculta en la maquina de otro seria una carpeta que creamos, nunca
vaciamos y nunca mencionamos. Asi que se desenlaza — y el dialogo promete lo que
va a pasar en vez de ofrecer "mover a la papelera". Una carpeta se recorre en
anchura y se borra en orden inverso (el `rmdir` de SFTP solo quita carpetas
vacias); un enlace simbolico se quita **como enlace**, nunca se entra en el, o se
estaria borrando lo que apunta en otro sitio. La raiz del filesystem se rechaza
antes de mandar nada.

**Duplicar mueve bytes, no texto** — un duplicado que convirtiera un PNG en
caracteres de reemplazo seria peor que no tener duplicado — y va **con tope**:
SFTP v3 no tiene copia en el servidor, asi que el fichero entero cruza el enlace
dos veces, y un elemento de menu no tiene por que arrastrar un gigabyte por la
conexion de nadie.

**Lo que solo puede hacer esta maquina ya no se ofrece** para una entrada remota:
revelar en el explorador, abrir con un editor local, buscar (recorre este
filesystem) y registrar como proyecto local. Y con el host desconectado, lo que
cambia la maquina se deshabilita: se puede leer lo que ya se leyo, pero no
mandarle nada.

## 5.10e Buscar en el proyecto del host — IMPLEMENTADO (fase 3, quinta parte)

`src-tauri/src/ssh/search.rs` + `src/lib/fsRouter.ts`. Por nombre de fichero y
por contenido.

**Por que git y no SFTP.** Todo lo demas de ficheros va por SFTP porque es un
subsistema y no exige instalar nada. Buscar es justo lo que SFTP **no** sabe
hacer: no tiene "find", asi que buscar sobre el es listar cada carpeta y leer
cada fichero, una peticion cada vez, a traves de la red. Un repositorio de
cualquier tamaño son miles de idas y vueltas por pulsacion.

Los clientes remotos maduros lo resuelven instalando en el host un servidor que
lleva `ripgrep`. El ayudante en el host esta descartado (§5.11), y exigir `rg`
pondria la funcion detras de algo que la mayoria de las maquinas no tiene. Asi
que se le pregunta a **git**, que ya esta en todo host con el que esta app puede
hacer algo util — la rama, la revision y el historial se ejecutan alli
(§5.10b, §5.10c). Dos ordenes, un viaje cada una:

- `git ls-files -co --exclude-standard -z`: cada fichero seguido y sin seguir que
  no este ignorado. Es **exactamente** lo que recorre la busqueda local (el crate
  `ignore` lee las mismas reglas de `.gitignore`), asi que las dos maquinas
  contestan sobre el mismo proyecto y no sobre dos ideas distintas de "el
  proyecto".
- `git grep -n -I --no-color -z`: las lineas que casan. **Los ficheros no cruzan
  el enlace**, solo las lineas.

**Los offsets del resaltado se calculan aqui**, no alli: `git grep` informa de
lineas, no de columnas, y el resaltado tiene que coincidir con lo que habria
producido la busqueda local. Cada linea devuelta se vuelve a casar con **el
mismo regex que construye la busqueda local** (`crate::fs::build_content_regex`),
asi que "que cuenta como coincidencia" tiene una sola definicion en la app. Si el
dialecto de git caso algo que el nuestro no (un regex exotico), la linea se
descarta en vez de enseñar un acierto que nada puede resaltar.

**El formato se midio contra el host, no se supuso**: `-z` deja `ruta NUL linea NUL texto`, terminado en salto de linea, y se lee campo a campo — partir primero por saltos de linea tiraria
justo la garantia que `-z` da (una ruta puede contener un salto de linea). Un
host con CRLF manda ademas el retorno de carro, que no es parte de la linea.

**Alcance honesto:** una carpeta del host que no es repositorio no se puede
buscar, y se dice — una lista vacia seria indistinguible de "no hay
coincidencias". "Buscar en la carpeta" acota con `-C`, y git contesta rutas
relativas a esa carpeta (medido tambien).

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

Fuera de la fase 3, y anotado en `FOR-DEV.md`: los **puertos reenviados** y el
**estado preciso de agentes** en un host, que necesitan un tunel inverso y
reporters instalados alli. La escalera de reconexion, que estaba en esta lista,
es ahora §5.12.

### La decision sobre el ayudante en el host: NO se construye

Estaba anotado como decision pendiente y aqui queda tomada, con lo medido.

**Que hacen los maduros.** Zed sube un binario `remote_server` a `~/.zed_server`
atado a la version exacta del cliente, y multiplexa con `ControlMaster` — que el
OpenSSH de Windows no implementa, o sea que su transporte no es copiable aqui.
VS Code instala su servidor y paga el precio en compatibilidad: desde la 1.99
exige **glibc ≥ 2.28**, y **Alpine/musl no esta soportado**; los sistemas viejos
necesitan un sysroot y `patchelf`.

**Por que aqui no hace falta.** Cada pieza que salio de la shell le quito su
razon de ser: los ficheros van por SFTP (§5.10), el explorador tambien (§5.8) y
la sonda pregunta en la shell que el host reporto (§5.3). Lo unico que queda con
forma de shell es git — y el panel de Cambios **pide el diff por fichero al
seleccionarlo**, no todos de golpe, asi que su forma natural son comandos
sueltos: ~2 s al abrir la pestaña y ~2 s por fichero abierto. Lento, no roto. Los
dos casos que parecian imposibles (stdin y binarios) los resuelve el SFTP que ya
esta abierto.

**Que coste tendria.** Un binario por arquitectura, versionado con la app, y una
clase de fallo nueva —"no pude instalar el servidor en tu maquina"— que hoy no
existe. Justo en la parte que mas se le pide a esta funcion: que sea facil.

**Que reabriria la decision.** Que Cambios, ya construido sobre `exec`, se sienta
lento en un host real. Entonces la conversacion deja de ser "¿ayudante si o no?"
y pasa a ser "estos N segundos por clic valen un binario que desplegar", que es
una pregunta que se responde con un numero. Mientras tanto la alternativa mas
barata sigue anotada: **mantener un canal de shell abierto** y escribirle los
comandos (§5.3), que quita el arranque de shell sin desplegar nada.

## 5.12 Como se prueba esto contra un host de verdad — IMPLEMENTADO

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

## 6. Que funciona y que no en un contexto remoto

| Capa de estado de agente (`02d`) | Remoto |
|---|---|
| Capa 2 — titulo / OSC | **Funciona sin trabajo extra**: viaja en el stream de bytes del PTY |
| Capa 1 — hooks HTTP | Requiere tunel inverso + instalar los reporters en el host. Fase posterior |
| Capa 3 — deteccion de proceso | Requiere sondeo remoto de procesos. Fase posterior |

| Panel sobre un proyecto remoto | Hoy |
|---|---|
| Terminal | **Funciona**: canal sobre la sesion del host, en la carpeta del proyecto |
| Ficheros | **Funciona** por SFTP (§5.10): listar, abrir, **guardar** (en el sitio, con fencing) y **previsualizar** imagenes y PDF. Sin marcado de ignorados y sin refresco automatico |
| Rama y estado git de la fila | **Funciona** (§5.10b): rama, cambios y distancia con el upstream, leidos en el host |
| Diff de imagenes / borrador con IA | **Funciona**: los bytes de la imagen viajan como bytes (§5.10h) y el agente corre en esta maquina sobre el diff leido alli. |
| Buscar (nombre y contenido) | **Funciona** preguntandole a git en el host — `ls-files` y `grep` (§5.10e). Solo dentro de un repositorio; si no lo es, se dice. |
| Crear / renombrar / duplicar / borrar en el arbol | **Funciona** por SFTP y cercado (§5.10d). Borrar es **permanente**: no hay papelera en un host, y el dialogo lo dice. |
| Cambios / Historial | **Funciona**: diff por fichero y por hunk, staging, descarte, commit, log y fetch/push/pull, ejecutados en el host. Sin sondeo: el boton refresca. Fuera: diff de imagenes y borrador con IA. §5.10c |
| GitHub | **No disponible**: lee el repositorio de esta maquina y su sesion de `gh`. El panel lo dice y ofrece la terminal. §5.11 |
| Refresco automatico de cualquiera de los anteriores | **No**: el watcher sondea cada 3 s y un `exec` cuesta ~2 s (§5.3). Se refresca al abrir, al actuar y con el boton |

Regla de honestidad para la interfaz: lo que no se puede medir en remoto se
marca **"no disponible en este entorno"**. Jamas se rellena con el dato local.

## 7. Fases

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Identidad de destino y fencing (`02a` §2.9) | **Hecho** |
| 1 | Registro de hosts, conexion, inventario, PTY remota, lanzador | **Hecha** — hecho: configuracion SSH, registro, conexion y claves, inventario, terminal remota, explorar carpetas, añadir un proyecto del host y seleccionarlo (§5.9), y el lanzador filtrado por el inventario del host. Sus deudas estan saldadas: presupuesto de canales (§5.10g), escalera de reconexion (§5.12) y el inventario en la interfaz (§5.13). Ya no: reconectar al arrancar los hosts que no piden nada, que se hace desde `ssh_hosts_resumable` |
| 2 | Estado preciso (tunel inverso + reporters remotos) | Pendiente |
| 3 | Archivos, git y worktrees remotos | **Hecha** — ficheros por SFTP (§5.10, leer, **guardar** y **previsualizar**), explorador por SFTP (§5.8), rama/estado de git (§5.10b), Cambios/Historial (§5.10c), las operaciones de fichero del arbol (§5.10d), la busqueda (§5.10e), el aviso de sesion caida (§5.10f), el presupuesto de canales (§5.10g) y las dos ultimas piezas del panel (§5.10h). Solo GitHub sigue siendo local, por lo que lee. El ayudante en el host queda **descartado**, con sus razones en §5.11 |
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

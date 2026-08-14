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
| §5.3 | comandos como canales, y su coste medido | implementado |

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

## 5.4 Registro de hosts y lapidas — LOGICA IMPLEMENTADA

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

Falta: la superficie de comandos Tauri que la UI llama.

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
nunca guardado), `ssh_host_disconnect`, `ssh_hosts_connected`.

Pendiente y anotado: reconectar al arrancar, y notificar una sesion caida — hoy
solo se nota cuando falla el siguiente comando.

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

**Dos shells**, porque un host no siempre es POSIX. Se intenta primero un script
POSIX con **login shell** (`sh -lc`) —sin `-l`, el PATH es el no interactivo,
donde nvm/mise/fnm no existen, que es la razon numero uno por la que un CLI
remoto parece no estar instalado— y, si no vuelve el marcador, uno de PowerShell
con **`-NoProfile -NonInteractive`**.

Con esas dos ramas se cubren las cuatro familias que el usuario tiene: **Linux y
macOS** por la POSIX; **Windows** por la de PowerShell; **WSL** por la POSIX
tambien, sea porque el `sshd` de la distro escucha en su propio puerto o porque
el shell del host es `bash`. La rama no se elige por lo que el host *dice ser*
sino por **cual contesta**: un Windows cuyo `sshd` lanza `bash` responde el sondeo
POSIX y se trata como tal, que es exactamente lo correcto.

**El script de PowerShell viaja en `-EncodedCommand`** (base64 de UTF-16LE), en
`ssh::powershell_command`. El comando que se envia lo interpreta *el shell que ese
`sshd` arranca* —`cmd`, `powershell`, `pwsh` o uno POSIX—, y cada uno trata
comillas y contrabarras a su manera: escapar a mano funciona en la maquina donde
se probo y produce basura en la siguiente. No es hipotetico — costo un listado que
volvia con una ruta de **una sola contrabarra** y cero entradas. El base64 no tiene
comillas, ni contrabarras, ni espacios: al shell exterior no le queda nada que
reinterpretar.

Los nombres de CLI se sanean antes de entrar en la linea de comandos remota. Hoy
vienen del catalogo propio; "hoy" es la palabra que deja de ser cierta tras un
refactor, y ese string acaba en un shell ajeno.

**Medido en vivo** contra el `sshd` de una maquina Windows: inventario completo
en **1.46 s incluyendo el intento POSIX fallido**, frente a los 2.1 s que costaba
un solo `echo` por el shell con perfil. Saltarse el perfil paga con creces el
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

**Lo que se lee en local se apaga, no se falsea.** Ficheros, cambios, historial y
GitHub se resuelven con el filesystem y el git de esta maquina. Con un espacio
remoto activo, `activeLocalPath` es `null` y esas capas no corren: el panel
derecho dice en que maquina vive el proyecto y que si funciona hoy. El modo de
fallo que sustituye es peor que un panel vacio — una carpeta del mismo nombre
**aqui** contesta a todas esas preguntas, con aplomo y sobre otro repositorio.
Por el mismo motivo `worktree_list` devuelve **un** espacio sin rama para un
proyecto remoto en vez de ejecutar git local, y la fila no dice `(detached)`:
decirlo seria afirmar algo sobre un repositorio que esta maquina no ha abierto.

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

**Un fichero remoto es de solo lectura, y se dice.** Guardar pasa por el
filesystem local: con la ruta de un host eso falla — o, peor, escribe un fichero
con ese nombre **aqui** mientras el editor informa de exito. Por eso es una
guarda y no un `catch`. La vista *Cambios* tampoco se ofrece (no hay diff remoto
todavia) y no se ejecuta git local para ese fichero, que es lo que sacaba un
error rojo encima de un archivo abierto correctamente.

**"El host no esta conectado" es un estado, no un fallo.** Al abrir la app antes
de conectar, el arbol se quedaba con el error hasta cambiar de proyecto y volver:
nada reintentaba, porque la raiz fallida nunca entraba en el conjunto cargado.
Ahora el backend lo distingue (`AppError::NotConnected`, codigo `NOT_CONNECTED`),
el panel dice que espera, y al conectar el host el arbol se rellena solo
(`fileTree.retryForHost`).

## 5.11 Lo que queda de la fase 3

Tres piezas, en orden de valor y de riesgo:

1. **Diff y staging remotos.** La rama y el recuento ya vienen (§5.10b); faltan
   el diff por fichero, el area de staging y el commit, que es lo que llenaria
   las pestañas Cambios e Historial en vez del aviso actual.
2. **Escritura de ficheros** por SFTP, con el fencing de `02a` §2.9 (una escritura
   preparada para un host no puede ejecutarse contra otro).
3. **Buscar en el arbol de un host** — hoy la accion se oculta, porque la busqueda
   recorre este filesystem.
4. **Un ayudante propio en el host** para lo que ni SFTP ni `exec` cubren bien:
   observar cambios, operaciones masivas rapidas y —lo importante— colocar una
   terminal en un directorio **como parametro**, no como texto tecleado. Es el
   camino que toman los clientes remotos maduros y el que hace desaparecer la
   pregunta "¿que shell tiene esta maquina?". Decision pendiente: que exige
   instalado, como se despliega y versiona, y que pasa en un host sin runtime.

## 6. Que funciona y que no en un contexto remoto

| Capa de estado de agente (`02d`) | Remoto |
|---|---|
| Capa 2 — titulo / OSC | **Funciona sin trabajo extra**: viaja en el stream de bytes del PTY |
| Capa 1 — hooks HTTP | Requiere tunel inverso + instalar los reporters en el host. Fase posterior |
| Capa 3 — deteccion de proceso | Requiere sondeo remoto de procesos. Fase posterior |

| Panel sobre un proyecto remoto | Hoy |
|---|---|
| Terminal | **Funciona**: canal sobre la sesion del host, en la carpeta del proyecto |
| Ficheros | **Funciona** por SFTP (§5.10): listar, abrir y **guardar** (en el sitio, con fencing). Sin busqueda, sin marcado de ignorados, sin refresco automatico y sin vista de Cambios |
| Rama y estado git de la fila | **Funciona** (§5.10b): rama, cambios y distancia con el upstream, leidos en el host |
| Cambios / Historial / GitHub | **No disponible**: el diff, el staging y el historial leen el git de esta maquina. El panel lo dice y ofrece la terminal. §5.11 |
| Rama y estado git de la fila | **No disponible**: sin git remoto no hay rama que mostrar. Fase 3 |

Regla de honestidad para la interfaz: lo que no se puede medir en remoto se
marca **"no disponible en este entorno"**. Jamas se rellena con el dato local.

## 7. Fases

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Identidad de destino y fencing (`02a` §2.9) | **Hecho** |
| 1 | Registro de hosts, conexion, inventario, PTY remota, lanzador | **Hecha** — hecho: configuracion SSH, registro, conexion y claves, inventario, terminal remota, explorar carpetas, añadir un proyecto del host y seleccionarlo (§5.9), y el lanzador filtrado por el inventario del host. Queda como deuda de la fase: escalera de reconexion, presupuesto de canales y mostrar el inventario en la UI |
| 2 | Estado preciso (tunel inverso + reporters remotos) | Pendiente |
| 3 | Archivos, git y worktrees remotos | **En curso** — ficheros por SFTP (§5.10, leer **y guardar**) y rama/estado de git (§5.10b) hechos; diff/staging, busqueda, operaciones de fichero y el ayudante en el host, pendientes (§5.11) |
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
